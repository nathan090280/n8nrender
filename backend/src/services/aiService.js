const axios = require('axios');

// Shared Anthropic Claude call used by all AI features (speech gen, edits, support replies)
async function callClaude(prompt, { maxTokens = 2000, temperature = 0.7, system } = {}) {
  const body = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }]
  };
  if (system) body.system = system;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    body,
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || process.env.OPENHANDS_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const text = response.data.content?.[0]?.text;
  if (!text) throw new Error('Claude returned empty response');
  return text;
}

const SUPPORT_CONTEXT = `You are the customer support assistant for SuperSpeech (superspeech.biz), an AI-powered custom speechwriting service.

BUSINESS FACTS (use these to answer accurately):
- Customers order via the questionnaire at superspeech.biz, choosing an occasion (weddings, corporate events, milestone celebrations, memorials & tributes), a tone (Serious, Humorous, Emotional or Pure Banter) and a package.
- Packages: The Toast (£9.99, ~2 minute speech, 3 edits included), The Main Event (£19.99, ~5 minute speech, 5 edits included), The Keynote (£34.99, ~10 minute speech, 7 edits included).
- Finished speeches are emailed to the customer and also appear in their dashboard (a free account is required to order).
- Edits are requested from the dashboard's speech viewer via "Request Edit".
- For anything you cannot resolve, suggest they reply to this email or write to hello@superspeech.biz.

HARD RULES:
- NEVER promise, offer, agree to or imply a refund — even if the customer asks for one. If a refund or serious complaint comes up, say their message has been passed to the team for review and they will hear back shortly. If they are unhappy with a speech, suggest requesting a free edit from their dashboard.
- Do not invent policies, guarantees, delivery times or discounts.
- Answer their actual question directly and helpfully — do not just acknowledge receipt.`;

async function generateSpeech(questionnaireData) {
  const {
    occasionType,
    recipientName,
    speakerName,
    subjectNames,
    relationship,
    tone,
    duration,
    keyPoints,
    specialMoments,
    audienceSize,
    customDetails,
    questionnaire
  } = questionnaireData;

  // Define tone-specific instructions
  const toneInstructions = {
    serious: 'Use a formal, respectful, and sincere tone. Focus on meaningful moments, life lessons, and heartfelt emotions. Avoid humor. Be dignified and profound.',
    humorous: 'Use humor, wit, and comedic timing throughout. Include funny anecdotes, playful jabs (all in good taste), and entertaining stories. Make the audience laugh while staying appropriate.',
    emotional: 'Use deeply emotional and touching language. Focus on love, gratitude, and meaningful connections. Include tear-jerking moments and heartfelt expressions. Make people feel.',
    'pure banter': 'Use playful teasing, light roasting, and witty banter throughout. Include inside jokes, funny observations, and comedic storytelling. Keep it fun and entertaining while staying respectful.'
  };

  const toneInstruction = toneInstructions[tone?.toLowerCase()] || toneInstructions.serious;

  // Create varied opening styles (random selection)
  const openingStyles = [
    'Start with a powerful personal story',
    'Begin with a thought-provoking question',
    'Open with a memorable quote that relates to the occasion',
    'Start with a vivid description of a specific moment',
    'Begin by addressing the audience directly and personally'
  ];
  const randomOpening = openingStyles[Math.floor(Math.random() * openingStyles.length)];

  // Build detailed prompt with questionnaire data
  let questionnaireDetails = '';
  if (questionnaire && typeof questionnaire === 'object') {
    questionnaireDetails = Object.entries(questionnaire)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }

  const subjectLine = subjectNames ? `Subject(s) of speech: ${subjectNames}` : '';
  const speakerLine = speakerName ? `Speaker: ${speakerName}` : '';
  const recipientLine = recipientName ? `Primary person being honored: ${recipientName}` : '';

  const prompt = `You are a world-class professional speechwriter. Write a unique, compelling ${occasionType} speech.

${subjectLine}
${speakerLine}
${recipientLine}
Relationship: ${relationship}
Occasion Type: ${occasionType}

CRITICAL - TONE REQUIREMENT: ${tone?.toUpperCase()}
${toneInstruction}

Detailed Information:
${questionnaireDetails || customDetails || 'Use the details provided above'}

SPECIFIC REQUIREMENTS:
1. OPENING STYLE: ${randomOpening} (make it unique and engaging)
2. TONE: Strictly maintain a ${tone} tone from start to finish
3. LENGTH: Approximately ${duration} minutes (${duration * 130} words)
4. STRUCTURE: Clear beginning, middle with stories/anecdotes, and powerful conclusion
5. PERSONALIZATION: Weave in specific details from the questionnaire naturally
6. AUTHENTICITY: Make it sound genuine, not AI-generated or generic
7. VARIETY: Do NOT use clichéd openings - be creative and original

AVOID:
- Generic phrases like "Good evening everyone" or "I'm honored to be here"
- Cookie-cutter speech structures
- Overused quotes
- Predictable transitions

Write a completely original, ${tone} speech now:`;

  try {
    // Use Anthropic Claude Sonnet 4.5 API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
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
        timeout: 30000
      }
    );

    const speechContent = response.data.content?.[0]?.text;
    
    if (!speechContent) {
      throw new Error('Claude returned empty response');
    }
    
    return {
      success: true,
      speech: speechContent,
      metadata: {
        occasionType,
        recipientName,
        speakerName,
        generatedAt: new Date().toISOString(),
        model: 'claude-sonnet-4.5'
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
  const prompt = `${SUPPORT_CONTEXT}

A customer has sent us this email:
Subject: ${subject}
From: ${senderEmail}

Email Content:
${emailContent}

Write a helpful, warm and professional reply that directly answers their question or addresses their concern with the facts above. Sign off as "The SuperSpeech Team".

Write the email reply now (do not include a subject line, just the email body):`;

  try {
    const replyContent = await callClaude(prompt, { maxTokens: 800, temperature: 0.7 });
    
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

async function editSpeech(originalSpeech, editRequest) {
  console.log('Editing speech with AI...');
  
  const prompt = `You are a professional speechwriter. A customer has requested edits to their speech.

ORIGINAL SPEECH:
${originalSpeech}

REQUESTED CHANGES:
${editRequest}

Please revise the speech according to the customer's requests. Keep the same overall structure and tone unless specifically asked to change it. Make the requested modifications while maintaining the quality and professionalism of the speech.

Return only the revised speech text, no explanations or meta-commentary.`;

  try {
    const editedSpeech = (await callClaude(prompt, { maxTokens: 4000, temperature: 0.7 })).trim();
    console.log('Speech edited successfully');
    return editedSpeech;
  } catch (error) {
    console.error('Error editing speech with AI:', error.response?.data || error.message);
    throw error; // Let the controller return an error instead of emailing an unedited speech
  }
}

async function generateContactReply(subject, message) {
  console.log('Generating AI reply for contact form...');
  
  const prompt = `${SUPPORT_CONTEXT}

A customer has sent the following message via the website contact form:

SUBJECT: ${subject || 'General Inquiry'}

MESSAGE:
${message}

Write a helpful, warm and conversational reply that directly answers their question or addresses their concern using the facts above. Sign off as "The SuperSpeech Team".

Write only the reply email body, no subject line.`;

  try {
    const reply = (await callClaude(prompt, { maxTokens: 800, temperature: 0.7 })).trim();
    console.log('Contact reply generated successfully');
    return reply;
  } catch (error) {
    console.error('Error generating contact reply:', error);
    return `Thank you for reaching out to SuperSpeech!

We've received your message and will get back to you within 24 hours. In the meantime, if you have any urgent questions about your order, please email us directly at hello@superspeech.biz.

We appreciate your patience and look forward to helping you!`;
  }
}

module.exports = {
  generateSpeech,
  generateEmailReply,
  editSpeech,
  generateContactReply
};
