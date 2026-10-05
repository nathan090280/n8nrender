const nodemailer = require('nodemailer');
const env = require('../config/env');

// Spacemail SMTP - same transport pattern as the SuperSpeech backend.
// All vars are WQ_-namespaced via config/env so this tenant can share a
// process with the SuperSpeech backend without touching its credentials.
const smtpPort = parseInt(env.EMAIL_PORT) || 587;
const smtpSecure = env.EMAIL_SECURE === 'true' || smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: env.EMAIL_HOST || 'mail.spacemail.com',
  port: smtpPort,
  secure: smtpSecure, // implicit TLS on 465, STARTTLS on 587
  auth: {
    user: env.EMAIL_USER,
    pass: env.EMAIL_PASSWORD
  },
  requireTLS: !smtpSecure,
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

const FROM_NAME = env.EMAIL_FROM_NAME || 'Williams Quantum';
const FROM_ADDR = env.EMAIL_FROM || 'products@williamsquantum.com';

async function sendAutoReply(recipientEmail, replyContent, subject) {
  const replyHtml = String(replyContent)
    .split(/\n{2,}/)
    .map(para => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const info = await transporter.sendMail({
    from: `${FROM_NAME} <${FROM_ADDR}>`,
    to: recipientEmail,
    subject: subject || 'Re: Your Williams Quantum Enquiry',
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
          <div style="margin: 20px 0; line-height: 1.6;">
            ${replyHtml}
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 12px; margin-top: 30px;">
            Williams Quantum - commercial intake gateway. Reply to this email to continue the conversation.
          </p>
        </body>
      </html>
    `,
    text: replyContent
  });
  console.log('Auto-reply sent:', info.messageId);
  return { success: true, messageId: info.messageId };
}

// Escalation notice to the principal when a lead conversation hits contract
// stage - includes the agent's proposed reply for one-word approval.
async function sendApprovalRequest({ leadEmail, leadName, subject, proposedReply, contextSummary }) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await transporter.sendMail({
    from: `WQ Agent Core <${FROM_ADDR}>`,
    to: env.APPROVER_EMAILS?.split(',')[0]?.trim() || FROM_ADDR,
    subject: `[WQ Agent] Contract approval: ${leadName || leadEmail}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;color:#1e293b;">
        <p><b>Contract-stage conversation detected.</b> The engine has paused negotiations and needs your decision.</p>
        <p><b>Lead:</b> ${esc(leadName || '')} &lt;${esc(leadEmail)}&gt;<br/>
        <b>Their subject:</b> ${esc(subject)}</p>
        <p><b>Situation:</b> ${esc(contextSummary)}</p>
        <hr/>
        <p><b>Proposed reply (sends your drafted terms):</b></p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:14px 18px;border-radius:8px;white-space:pre-wrap;">${esc(proposedReply)}</div>
        <p>Reply <b>Approved</b> to send it as-is, <b>Rejected</b> to close the lead politely, or edit the draft and reply <b>Approved</b> - the engine will send your edited version.</p>
      </div>`
  });
}

async function verifyEmailConnection() {
  try {
    await transporter.verify();
    console.log('Email server is ready');
    return true;
  } catch (error) {
    console.error('Email connection failed:', error.message);
    return false;
  }
}

module.exports = { sendAutoReply, sendApprovalRequest, verifyEmailConnection, transporter, FROM_ADDR };
