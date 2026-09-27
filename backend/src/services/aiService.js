const axios = require('axios');

async function generateSpeech(questionnaireData) {
  const {
    occasionType,
    recipientName,
    speakerName,
    relationship,
    tone,
    duration,
    keyPoints,
    specialMoments,
    audienceSize,
    customDetails
  } = questionnaireData;

  const prompt = `You are a professional speechwriter. Create a heartfelt and engaging ${occasionType} speech with the following details:

Speaker: ${speakerName}
For: ${recipientName}
Relationship: ${relationship}
Tone: ${tone}
Duration: ${duration} minutes
Audience Size: ${audienceSize}

Key Points to Include:
${keyPoints ? keyPoints.map((point, i) => `${i + 1}. ${point}`).join('\n') : 'N/A'}

Special Moments to Mention:
${specialMoments || 'N/A'}

Additional Details:
${customDetails || 'N/A'}

Please write a complete, well-structured speech that:
1. Has a strong opening that captures attention
2. Includes personal anecdotes and heartfelt moments
3. Maintains the requested tone throughout
4. Is approximately ${duration} minutes when read aloud (roughly ${duration * 130} words)
5. Has a memorable conclusion
6. Feels natural and authentic

Write the speech now:`;

  try {
    // Use Anthropic Claude API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        system: 'You are a professional speechwriter who creates heartfelt, engaging speeches for special occasions.',
        temperature: 0.8
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      }
    );

    const speechContent = response.data.content?.[0]?.text;
    
    if (!speechContent) {
      throw new Error('Anthropic returned empty response');
    }
    
    return {
      success: true,
      speech: speechContent,
      metadata: {
        occasionType,
        recipientName,
        speakerName,
        generatedAt: new Date().toISOString(),
        model: 'claude-3-5-sonnet'
      }
    };
  } catch (error) {
    console.error('❌ AI speech generation FAILED:', error.response?.data || error.message);
    
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

async function generateEmailReply(emailContent, senderEmail, subject) {
  const prompt = `You are a helpful customer service agent for SuperSpeech, a service that creates custom speeches for special occasions.

A customer has sent us this email:
Subject: ${subject}
From: ${senderEmail}

Email Content:
${emailContent}

Please write a helpful, professional, and friendly response that:
1. Acknowledges their inquiry or concern
2. Provides useful and actionable information
3. Is polite and empathetic
4. Does NOT agree to full refunds without proper review
5. Offers to help further if needed
6. Keeps the tone warm but profe

Wrissionalte the email reply now (do not include subject line, just the email body):`;

  try {
    const response = await axios.post(
      `${process.env.OPENHANDS_API_URL}/conversations`,
      {
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        model: 'gpt-4',
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENHANDS_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const replyContent = response.data.choices?.[0]?.message?.content || response.data.response;
    
    return {
      success: true,
      reply: replyContent,
      metadata: {
        originalSubject: subject,
        senderEmail,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Error generating email reply with AI:', error.response?.data || error.message);
    
    return {
      success: false,
      error: error.message,
      fallbackReply: generateFallbackEmailReply(senderEmail)
    };
  }
}

function generateFallbackSpeech(data) {
  const { occasionType, recipientName, speakerName, relationship } = data;
  
  return `Dear friends and family,

Today is a very special day as we celebrate ${recipientName}. As their ${relationship}, I've had the privilege of witnessing so many wonderful moments.

${recipientName}, you have brought so much joy and meaning into our lives. Your kindness, strength, and spirit inspire everyone around you.

On this ${occasionType}, I want you to know how much you mean to all of us. May this special occasion be filled with happiness, laughter, and beautiful memories.

Here's to you, ${recipientName}!

With love and best wishes,
${speakerName}`;
}

function generateFallbackEmailReply(senderEmail) {
  return `Thank you for reaching out to SuperSpeech!

We've received your email and our team is reviewing it carefully. We typically respond to all inquiries within 24 hours.

In the meantime, if you have questions about your speech order, you can:
- Check your email for your speech delivery
- Visit our FAQ section at superspeech.biz/faq
- Reply to this email with any urgent concerns

We appreciate your patience and look forward to helping you create the perfect speech!`;
}

module.exports = {
  generateSpeech,
  generateEmailReply
};
