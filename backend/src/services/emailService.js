const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendSpeechEmail(recipientEmail, recipientName, speechContent, occasionType) {
  const mailOptions = {
    from: `SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: recipientEmail,
    subject: `Your Custom ${occasionType} Speech is Ready!`,
    html: `<html><body><h1>Your Speech is Ready!</h1><p>Dear ${recipientName},</p><p>Your custom speech:</p><pre>${speechContent}</pre></body></html>`,
    text: `Your ${occasionType} speech:\n\n${speechContent}`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Speech email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('⚠ Email sending failed (will continue without email):', error.message);
    // Don't throw - return success anyway so the rest of the flow continues
    return { success: false, messageId: null, error: error.message };
  }
}

async function sendAutoReply(recipientEmail, replyContent, subject) {
  const mailOptions = {
    from: `SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: recipientEmail,
    subject: subject || 'Re: Your SuperSpeech Inquiry',
    html: `<html><body>${replyContent}</body></html>`,
    text: replyContent
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Auto-reply email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending auto-reply:', error);
    throw error;
  }
}

async function verifyEmailConnection() {
  try {
    await transporter.verify();
    console.log('Email server is ready');
    return true;
  } catch (error) {
    console.error('Email connection failed:', error);
    return false;
  }
}

module.exports = {
  sendSpeechEmail,
  sendAutoReply,
  verifyEmailConnection
};
