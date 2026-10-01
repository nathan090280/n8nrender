const crypto = require('crypto');
const emailService = require('./emailService');
const firebaseService = require('./firebaseService');

const BACKEND_URL = process.env.N8N_WEBHOOK_URL || 'https://superspeech-backend.onrender.com';

// Signed unsubscribe tokens so a link can't be used to unsubscribe
// arbitrary strangers - the token proves the link came from us.
function unsubscribeToken(email) {
  const secret = process.env.API_SECRET_KEY || 'superspeech-unsub';
  return crypto.createHmac('sha256', secret)
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function unsubscribeUrl(email) {
  return `${BACKEND_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;
}

function verifyUnsubscribeToken(email, token) {
  if (!email || !token) return false;
  const expected = unsubscribeToken(email);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(String(token).padEnd(expected.length, '0').slice(0, expected.length))
  );
}

// Branded campaign wrapper. Content is supplied by the caller (agent);
// this template owns the header, footer and unsubscribe link.
function buildCampaignHtml(contentHtml, unsubUrl) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;">
  <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
    <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
      <h1 style="color:#ffffff;margin:0;font-size:22px;letter-spacing:0.5px;">SuperSpeech</h1>
      <p style="color:#dbeafe;margin:6px 0 0;font-size:12px;">Professional Speeches for Any Occasion</p>
    </div>
    <div style="background:#ffffff;padding:28px 24px;color:#1e293b;font-size:15px;line-height:1.7;">
      ${contentHtml}
    </div>
    <div style="background:#f8fafc;padding:16px 24px;text-align:center;font-size:12px;color:#64748b;border-radius:0 0 12px 12px;">
      <p style="margin:0 0 6px;">You're receiving this because you joined the SuperSpeech mailing list at <a href="https://superspeech.biz" style="color:#2563eb;">superspeech.biz</a>.</p>
      <p style="margin:0;"><a href="${unsubUrl}" style="color:#64748b;">Unsubscribe</a> &middot; <a href="https://superspeech.biz/privacy.html" style="color:#64748b;">Privacy Policy</a></p>
    </div>
  </div>
</body></html>`;
}

function buildCampaignText(contentText, unsubUrl) {
  return `${contentText}\n\n---\nYou're receiving this because you joined the SuperSpeech mailing list.\nUnsubscribe: ${unsubUrl}`;
}

// Send a campaign to every active subscriber. Each recipient gets a
// personalised unsubscribe link in the footer.
async function sendCampaign({ subject, html, text }) {
  const subscribers = await firebaseService.getMailingListSubscribers();
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  for (const email of subscribers) {
    const unsubUrl = unsubscribeUrl(email);
    try {
      await emailService.transporter.sendMail({
        from: `SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
        to: email,
        subject,
        html: buildCampaignHtml(html, unsubUrl),
        text: buildCampaignText(text, unsubUrl),
        headers: { 'List-Unsubscribe': `<${unsubUrl}>` }
      });
      results.sent++;
    } catch (err) {
      results.failed++;
      results.errors.push({ email, error: err.message });
    }
  }

  console.log(`Mailing list campaign "${subject}": ${results.sent} sent, ${results.failed} failed`);
  return results;
}

module.exports = {
  sendCampaign,
  unsubscribeUrl,
  verifyUnsubscribeToken
};
