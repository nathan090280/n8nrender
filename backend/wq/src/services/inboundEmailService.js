const aiService = require('./aiService');
const emailService = require('./emailService');
const env = require('../config/env');
const { db } = require('../config/store');

function senderEmail(from) {
  const m = String(from || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return (m ? m[0] : String(from || '')).toLowerCase();
}

function isApprover(from) {
  const allow = (env.APPROVER_EMAILS || env.EMAIL_FROM || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(senderEmail(from));
}

async function trackLeadReply(from, subject, content) {
  try {
    const email = senderEmail(from);
    const snap = await db.collection('leads').where('email', '==', email).limit(1).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const replies = doc.data().replies || [];
    replies.push({ at: new Date().toISOString(), subject, snippet: String(content || '').slice(0, 500) });
    const patch = { lastReplyAt: new Date().toISOString(), replies };
    if (doc.data().status !== 'awaiting_approval') patch.status = 'replied';
    await doc.ref.update(patch);
    await db.collection('agentActions').add({
      date: new Date().toISOString().slice(0, 10),
      type: 'lead_reply',
      title: `${doc.data().name || email} replied`,
      targetEmail: email,
      summary: subject,
      createdAt: new Date().toISOString()
    });
  } catch (e) { console.warn('lead reply tracking failed:', e.message); }
}

// "Approved"/"Rejected" replies from the principal drive the contract gate
// and the unsent-outreach-draft flow. Returns true if the mail was handled.
async function tryHandleApproval({ from, subject, text }) {
  if (!isApprover(from)) return false;
  const body = String(text || '').trim();
  const approved = /^\s*(approved?|yes|send it|go ahead|lgtm|ship)\b/i.test(body);
  const rejected = /^\s*(reject|decline|no\b|stop|close|kill)/i.test(body);
  if (!approved && !rejected) return false;

  // --- Contract gate: "[WQ Agent] Contract approval: <name>" ---
  const contractMatch = String(subject || '').match(/re:\s*\[wq agent\]\s*contract approval:\s*(.+)/i);
  if (contractMatch) {
    const name = contractMatch[1].trim();
    const snap = await db.collection('pendingApprovals').orderBy('createdAt', 'desc').limit(30).get();
    const pending = snap.docs.find(d => {
      const x = d.data();
      return x.status === 'pending'
        && ((x.leadName || '').toLowerCase() === name.toLowerCase()
          || (x.leadEmail || '').toLowerCase() === name.toLowerCase());
    });
    if (!pending) {
      await emailService.sendAutoReply(from,
        `Couldn't find a pending contract approval for "${name}" - it may already be decided.`,
        `Re: ${subject}`);
      return true;
    }
    const p = pending.data();

    if (approved) {
      // If the principal edited the draft, honour their version: strip the
      // quoted original (everything below a ">" line or an "On ... wrote:" header).
      const edited = body.split(/\n>/)[0].split(/\nOn .+ wrote:/i)[0]
        .replace(/^\s*(approved?|yes|send it|go ahead|lgtm|ship)\b[.,!]?\s*/i, '').trim();
      const outgoing = edited.length > 40 ? edited : p.draftReply;
      await emailService.transporter.sendMail({
        from: `Williams Quantum <${env.EMAIL_FROM}>`,
        to: p.leadEmail,
        subject: `Re: ${p.subject || 'Williams Quantum'}`,
        text: outgoing,
        html: String(outgoing).split(/\n+/).filter(Boolean)
          .map(x => `<p style="margin:0 0 14px;line-height:1.6;">${x}</p>`).join('')
      });
      await pending.ref.update({ status: 'approved', decidedAt: new Date().toISOString() });
      const leadSnap = await db.collection('leads').where('email', '==', p.leadEmail).limit(1).get();
      if (!leadSnap.empty) await leadSnap.docs[0].ref.update({ status: 'negotiating' });
      await emailService.sendAutoReply(from,
        `Sent - your ${edited.length > 40 ? 'edited' : 'drafted'} reply went to ${p.leadName || p.leadEmail} (${p.leadEmail}). Thread is back with the engine.`,
        `Re: ${subject}`);
      console.log(`[Approval] contract reply sent to ${p.leadEmail}`);
    } else {
      await pending.ref.update({ status: 'rejected', decidedAt: new Date().toISOString() });
      const leadSnap = await db.collection('leads').where('email', '==', p.leadEmail).limit(1).get();
      if (!leadSnap.empty) await leadSnap.docs[0].ref.update({ status: 'closed' });
      await emailService.sendAutoReply(from,
        `Closed - ${p.leadName || p.leadEmail} marked declined. No reply was sent; say the word if you want a polite close-out emailed instead.`,
        `Re: ${subject}`);
      console.log(`[Approval] lead ${p.leadEmail} declined by principal`);
    }
    return true;
  }

  // --- Unsent outreach draft: "[WQ Agent] Outreach draft (not sent): <name>" ---
  const outreachMatch = String(subject || '').match(/re:\s*\[wq agent\]\s*outreach draft \(not sent\):\s*(.+)/i);
  if (outreachMatch) {
    const name = outreachMatch[1].trim();
    const acts = await db.collection('agentActions').orderBy('createdAt', 'desc').limit(30).get();
    const act = acts.docs.find(d => {
      const x = d.data();
      return x.detail?.emailNotSent && x.detail?.draftTo
        && (x.detail?.draftedFor || '').toLowerCase() === name.toLowerCase();
    });
    if (!act) {
      await emailService.sendAutoReply(from,
        `Couldn't find an unsent outreach draft for "${name}" - it may already have been sent.`,
        `Re: ${subject}`);
      return true;
    }
    if (rejected) {
      await act.ref.update({ 'detail.rejectedByOwner': true });
      await emailService.sendAutoReply(from, `Scrapped - the draft to ${name} won't be sent.`, `Re: ${subject}`);
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
      from: `Williams Quantum <${env.EMAIL_FROM}>`,
      to: det.draftTo, subject: det.draftSubject, text: String(det.draftBody || ''),
      html: String(det.draftBody || '').split(/\n+/).filter(Boolean).map(x => `<p style="margin:0 0 14px;line-height:1.6;">${x}</p>`).join('')
    });
    await act.ref.update({ 'detail.emailNotSent': null, 'detail.approvedSent': true });
    await require('./agentService').recordLead({
      email: det.draftTo, name: det.draftedFor, subject: det.draftSubject,
      body: det.draftBody, source: 'agent-draft-approved'
    });
    await emailService.sendAutoReply(from,
      `Sent - the outreach email to ${det.draftedFor} (${det.draftTo}) just went out and they're in the leads list.`,
      `Re: ${subject}`);
    console.log(`[Approval] outreach sent via email approval: ${det.draftTo}`);
    return true;
  }

  return false;
}

const HOLDING_REPLY = `Thank you - this is moving into commercial terms, which is exactly where we want it.

I've passed the thread to our principal to confirm specifics personally. You'll hear back directly with proposed terms rather than anything provisional from me.

Nothing is agreed until it's in writing from the principal - consider this a hold, not a delay.

Williams Quantum - Commercial Development`;

async function processInboundEmail({ from, subject, text, html }) {
  const emailContent = text || html;
  if (!from || !emailContent) throw new Error('Missing required email fields');

  // Principal approvals first.
  if (await tryHandleApproval({ from, subject, text: emailContent })) {
    return { approved: true };
  }

  const { findLead, generateLeadReply, escalateForApproval, brandCheck } = require('./agentService');
  const lead = await findLead(senderEmail(from)).catch(() => null);

  let replyContent;
  if (lead) {
    console.log('Lead reply - continuing outreach conversation with:', from);
    const outcome = await generateLeadReply(lead, { from, subject, text: emailContent })
      .catch(() => null);

    if (outcome?.held) {
      // CONTRACT GATE: draft parked, principal emailed, lead gets a holding
      // reply only. Thread resumes after an Approved reply.
      console.log(`[Gate] contract stage reached with ${from} - escalating (${outcome.held.reason})`);
      await escalateForApproval(lead, { from, subject, text: emailContent, draft: outcome.held.draft });
      replyContent = HOLDING_REPLY;
    } else {
      replyContent = outcome?.reply;
    }
  }
  if (!replyContent) {
    console.log('Generating AI reply for email from:', from);
    const replyResult = await aiService.generateEmailReply(emailContent, from, subject);
    replyContent = replyResult.success ? replyResult.reply : replyResult.fallbackReply;
  }

  if (brandCheck(replyContent)) {
    console.warn('Reply tripped brand guard, sending safe fallback');
    replyContent = `Hi,\n\nThanks for contacting Williams Quantum - your enquiry has been passed to the team and you'll hear back shortly.\n\nOur portfolio and licensing information is at https://williamsquantum.com.\n\nWilliams Quantum\nproducts@williamsquantum.com`;
  }

  console.log('Sending reply to:', from);
  const emailResult = await emailService.sendAutoReply(
    from, replyContent, `Re: ${subject || 'Your Williams Quantum Enquiry'}`
  );

  await trackLeadReply(from, subject, emailContent);

  await db.collection('emailInteractions').add({
    from, subject,
    originalContent: String(emailContent).slice(0, 3000),
    replyContent,
    replySent: true,
    emailMessageId: emailResult.messageId,
    createdAt: new Date().toISOString()
  });

  return { replyContent, emailMessageId: emailResult.messageId };
}

module.exports = { processInboundEmail };
