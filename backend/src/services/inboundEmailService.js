const aiService = require('./aiService');
const emailService = require('./emailService');
const firebaseService = require('./firebaseService');
const { db } = require('../config/firebase');

// If the sender is a known outreach lead, flip them to 'replied' and log it
// so tonight's digest flags the warm reply.
async function trackLeadReply(from, subject, content) {
  try {
    const email = (from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [from])[0].toLowerCase();
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
