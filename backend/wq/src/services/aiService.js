const axios = require('axios');
const env = require('../config/env');

// Shared Anthropic Claude call used by every agent feature.
// (Ported from the SuperSpeech backend - same interface.)
// Key resolution: WQ_ANTHROPIC_API_KEY, else the shared host keys
// (ANTHROPIC_API_KEY / OPENHANDS_API_KEY) - see config/env.js.
async function callClaude(prompt, { maxTokens = 2000, temperature = 0.7, system } = {}) {
  const body = {
    model: env.ANTHROPIC_MODEL,
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
        'x-api-key': env.ANTHROPIC_API_KEY,
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

const SUPPORT_CONTEXT = `You are the commercial intake assistant for Williams Quantum (williamsquantum.com), a deep-tech invention lab and B2B portfolio operation.

BUSINESS FACTS:
- Williams Quantum develops proprietary hardware concepts to prototype stage and licenses them to industry partners.
- Portfolio: SENTINEL CAP (combination-lock drink cover for pubs/festivals), PITTASAFE (steam-safe pitta pocket cutter - clamps hot bread, overhead tonearm saw slices the pocket), ORBITCUT (anti-"avocado hand" rotary scoring station), BATHBUDDY (all-mechanical hand-cranked bath foam cannon - no electrics near water), VANLIFE STARTMATE (plug-and-play inline soft-starter that lets small 240V inverters start demanding campervan/off-grid appliances) - all concept-stage; UP AND ATOM (playable educational chemistry game, live at upandatom.netlify.app). All available for licensing.
- Commercial intake gateway: products@williamsquantum.com.
- We offer licensing agreements, joint development, and technical briefings - not retail sales, jobs, or consulting.

PITCH INSTINCT (apply when a question is open-ended enough to warrant it):
- We are an IP house: the partner handles development, manufacturing and distribution. Frame concepts as de-risked, ready-to-license assets for their pipeline.
- Their benefit first, always - market gap, category growth, competitive edge. Never our excitement.
- End with ONE low-friction next step (e.g. an overview or NDA-gated technical pack). Never reveal engineering detail beyond the public product pages.

HARD RULES:
- NEVER quote prices, royalties, percentages, exclusivity terms, or contract language. If a conversation approaches commercial terms, say the principal will confirm specifics directly.
- Do not invent products, patents, certifications, or partnerships.
- Answer their actual question directly and helpfully.`;

// Generic pass-through used by the agent engine - caller supplies the prompt.
async function generateSocialCopy(prompt, opts = {}) {
  return callClaude(prompt, { maxTokens: 1500, temperature: 0.9, ...opts });
}

async function generateEmailReply(emailContent, senderEmail, subject) {
  const prompt = `${SUPPORT_CONTEXT}

Someone has emailed us:
Subject: ${subject}
From: ${senderEmail}

Email Content:
${emailContent}

Write a helpful, professional reply that directly answers their question using the facts above. Sign off as "Williams Quantum - Commercial Intake".

Write the email reply now (no subject line, just the body):`;

  try {
    const reply = await callClaude(prompt, { maxTokens: 800, temperature: 0.7 });
    return { success: true, reply };
  } catch (error) {
    console.error('AI reply generation failed:', error.message);
    return {
      success: false,
      error: error.message,
      fallbackReply: `Thank you for contacting Williams Quantum.\n\nYour enquiry has been received and triaged by our intake engine - a member of the team will follow up shortly.\n\nFor licensing and product enquiries, this mailbox (products@williamsquantum.com) is the correct gateway.\n\nWilliams Quantum`
    };
  }
}

module.exports = { generateSocialCopy, generateEmailReply };
