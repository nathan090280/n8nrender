const aiService = require('./aiService');
const emailService = require('./emailService');
const firebaseService = require('./firebaseService');

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
