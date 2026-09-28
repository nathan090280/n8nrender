const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'mail.spacemail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false, // Use STARTTLS on port 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  },
  requireTLS: true,
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 10000, // 10 second connection timeout
  greetingTimeout: 10000,   // 10 second greeting timeout
  socketTimeout: 10000       // 10 second socket timeout
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
    console.error('❌ Email sending FAILED:', error.message);
    // THROW the error - email delivery is part of the service!
    throw new Error('Failed to send email: ' + error.message);
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

async function sendUpdatedSpeech(recipientEmail, editedSpeech, editCount) {
  const mailOptions = {
    from: `SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: recipientEmail,
    subject: `Your Edited Speech (Edit #${editCount}) is Ready!`,
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #667eea;">Your Updated Speech is Ready!</h1>
          <p>We've made the changes you requested. Here's your edited speech:</p>
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <pre style="white-space: pre-wrap; font-family: Georgia, serif; line-height: 1.6;">${editedSpeech}</pre>
          </div>
          <p>You can also view this speech in your dashboard at <a href="https://superspeech.biz">superspeech.biz</a></p>
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            If you need further changes, you can request another edit from your dashboard.
          </p>
        </body>
      </html>
    `,
    text: `Your updated speech (Edit #${editCount}):\n\n${editedSpeech}\n\nView in your dashboard at superspeech.biz`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Updated speech email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send updated speech email:', error);
    throw error;
  }
}

async function sendContactReply(recipientEmail, recipientName, subject, originalMessage, aiReply) {
  const mailOptions = {
    from: `SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: recipientEmail,
    subject: `Re: ${subject || 'Your Message to SuperSpeech'}`,
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #667eea;">Hi ${recipientName},</h2>
          <div style="margin: 20px 0; line-height: 1.6;">
            ${aiReply.split('\n').map(para => `<p>${para}</p>`).join('')}
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #666; font-size: 13px;">
            <strong>Your original message:</strong><br/>
            ${originalMessage.split('\n').map(para => para).join('<br/>')}
          </p>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">
            This is an automated response. If you need further assistance, feel free to reply to this email.
          </p>
        </body>
      </html>
    `,
    text: `Hi ${recipientName},\n\n${aiReply}\n\n---\nYour original message:\n${originalMessage}`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Contact reply sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send contact reply:', error);
    throw error;
  }
}

async function sendContactCopyToBusiness(customerName, customerEmail, subject, message, aiReply) {
  const mailOptions = {
    from: `SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: 'hello@superspeech.biz',
    subject: `[Contact Form] ${subject || 'No Subject'} - from ${customerName}`,
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
          <h2>New Contact Form Submission</h2>
          <p><strong>From:</strong> ${customerName} (${customerEmail})</p>
          <p><strong>Subject:</strong> ${subject || 'No Subject'}</p>
          
          <h3>Customer Message:</h3>
          <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 10px 0;">
            ${message.split('\n').map(para => `<p>${para}</p>`).join('')}
          </div>
          
          <h3>AI Response Sent:</h3>
          <div style="background: #e8f4f8; padding: 15px; border-radius: 5px; margin: 10px 0;">
            ${aiReply.split('\n').map(para => `<p>${para}</p>`).join('')}
          </div>
          
          <hr />
          <p style="color: #666; font-size: 13px;">
            This is a copy of the automated response. Reply to ${customerEmail} if further action is needed.
          </p>
        </body>
      </html>
    `,
    text: `New Contact Form\n\nFrom: ${customerName} (${customerEmail})\nSubject: ${subject}\n\nMessage:\n${message}\n\nAI Response:\n${aiReply}`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Business copy sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send business copy:', error);
    // Don't throw - business copy failure shouldn't stop the workflow
    return { success: false, error: error.message };
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
  sendUpdatedSpeech,
  sendContactReply,
  sendContactCopyToBusiness,
  verifyEmailConnection
};
