const aiService = require('./aiService');
const emailService = require('./emailService');
const firebaseService = require('./firebaseService');
const { db } = require('../config/firebase');

// If the sender is a known outreach lead, flip them to 'replied' and log it
// so tonight's digest flags the warm reply.
async function trackLeadReply(from, subject, content) {
  try {
    const email = senderEmail(from);
    const snap = await db.collection('marketingLeads').where('email', '==', email).limit(1).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const replies = doc.data().replies || [];
    replies.push({ at: new Date().toISOString(), subject, snippet: String(content || '').slice(0, 500) });
    await doc.ref.update({ status: 'replied', lastReplyAt: new Date().toISOString(), replies });
    await db.collection('marketingActions').add({
      date: new Date().toISOString().slice(0, 10),
      type: 'lead_reply',
      title: `${doc.data().name || email} replied!`,
      targetEmail: email,
      summary: subject,
      createdAt: new Date().toISOString()
    });
  } catch (e) { console.warn('lead reply tracking failed:', e.message); }
}

function senderEmail(from) {
  const m = String(from || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return (m ? m[0] : String(from || '')).toLowerCase();
}

function isApprover(from) {
  const allow = (process.env.APPROVER_EMAILS || 'nathan090280@yahoo.co.uk,hello@superspeech.biz')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(senderEmail(from));
}

// Turns "Approved" replies to agent emails into actions - tip drafts get
// published, unsent outreach drafts get sent. Returns true if handled.
async function tryHandleApproval({ from, subject, text }) {
  if (!isApprover(from)) return false;
  if (!/^\s*(approved?|yes|publish|looks good|go ahead|lgtm)\b/i.test(String(text || '').trim()))
    return false;

  const tipMatch = String(subject || '').match(/re:\s*\[marketing agent\]\s*(tip draft|new tip draft):\s*(.+)/i);
  if (tipMatch) {
    const title = tipMatch[2].replace(/<[^>]+>/g, '').trim();
    const snap = await db.collection('tipDrafts').where('status', '==', 'draft').get();
    const doc = snap.docs.find(d => (d.data().title || '').toLowerCase() === title.toLowerCase());
    if (!doc) {
      await emailService.sendAutoReply(from,
        `Couldn't find a pending draft called "${title}" - it may already be published. Send me the exact title and I'll check.`,
        `Re: ${subject}`);
      return true;
    }
    const d = doc.data();
    const body = String(d.bodyHtml || '')
      .replace(/<\/(p|h1|h2|h3|li|div)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
    await db.collection('tips').add({
      title: d.title, body, published: true,
      source: 'marketing-agent-approved', createdAt: new Date().toISOString()
    });
    await doc.ref.update({ status: 'published', publishedAt: new Date().toISOString() });
    const { slugify } = require('../controllers/tipsPageController');
    const url = `https://superspeech.biz/tips/${slugify(d.title)}`;
    await emailService.sendAutoReply(from,
      `Published! "${d.title}" is live at ${url} - it's in the sitemap and tips index already.`,
      `Re: ${subject}`);
    console.log(`[Approval] tip published via email approval: ${d.title}`);
    return true;
  }

  const outreachMatch = String(subject || '').match(/re:\s*\[marketing agent\]\s*outreach draft \(not sent\):\s*(.+)/i);
  if (outreachMatch) {
    const name = outreachMatch[2].trim();
    const acts = await db.collection('marketingActions').orderBy('createdAt', 'desc').limit(30).get();
    const act = acts.docs.find(d => {
      const x = d.data();
      return x.type === 'cold_outreach' && x.detail?.notSent && x.detail?.draftTo
        && (x.detail?.draftedFor || '').toLowerCase() === name.toLowerCase();
    });
    if (!act) {
      await emailService.sendAutoReply(from,
        `Couldn't find an unsent outreach draft for "${name}" - it may already have been sent.`,
        `Re: ${subject}`);
      return true;
    }
    const det = act.data().detail;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(det.draftTo || '')) {
      await emailService.sendAutoReply(from,
        `The saved address for "${name}" (${det.draftTo || 'none'}) doesn't look valid - not sending.`,
        `Re: ${subject}`);
      return true;
    }
    await emailService.transporter.sendMail({
      from: `Nathan @ SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
      to: det.draftTo, subject: det.draftSubject, text: String(det.draftBody || ''),
      html: String(det.draftBody || '').split(/\n+/).filter(Boolean).map(p => `<p style="margin:0 0 14px;line-height:1.6;">${p}</p>`).join('')
    });
    await act.ref.update({ 'detail.notSent': null, 'detail.approvedSent': true });
    await require('./marketingAgentService').recordLead({
      email: det.draftTo, name: det.draftedFor, subject: det.draftSubject,
      body: det.draftBody, source: 'agent-draft-approved'
    });
    await emailService.sendAutoReply(from,
      `Sent! The outreach email to ${det.draftedFor} (${det.draftTo}) just went out, and they're in the leads list now.`,
      `Re: ${subject}`);
    console.log(`[Approval] outreach sent via email approval: ${det.draftTo}`);
    return true;
  }

  return false;
}

/**
 * Process a single inbound email: generate an AI reply, send it,
 * and record the interaction for the dashboard. Shared by the
 * /incoming-email webhook and the IMAP poller.
 */
async function processInboundEmail({ from, subject, text, html }) {
  const emailContent = text || html;
  if (!from || !emailContent) {
    throw new Error('Missing required email fields');
  }

  // Owner approvals ("Approved" reply to a draft) take precedence over the
  // generic AI reply path.
  if (await tryHandleApproval({ from, subject, text: emailContent })) {
    return { approved: true };
  }

  console.log('Generating AI reply for email from:', from);
  const replyResult = await aiService.generateEmailReply(emailContent, from, subject);

  let replyContent;
  if (replyResult.success) {
    replyContent = replyResult.reply;
  } else {
    console.warn('AI reply generation failed, using fallback');
    replyContent = replyResult.fallbackReply;
  }

  console.log('Sending auto-reply to:', from);
  const emailResult = await emailService.sendAutoReply(
    from,
    replyContent,
    `Re: ${subject || 'Your SuperSpeech Inquiry'}`
  );

  await trackLeadReply(from, subject, emailContent);

  await firebaseService.saveEmailInteraction({
    from,
    subject,
    originalContent: emailContent,
    replyContent,
    replySent: true,
    emailMessageId: emailResult.messageId
  });

  return { replyContent, emailMessageId: emailResult.messageId };
}

module.exports = { processInboundEmail };
