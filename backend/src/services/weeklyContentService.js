const { db } = require('../config/firebase');
const aiService = require('./aiService');
const mailingListService = require('./mailingListService');
const firebaseService = require('./firebaseService');

// Weekly content jobs, driven by the socialScheduler tick:
//   - New tip page published twice a week (default Tue + Fri, ~10:00 UK)
//   - One colourful newsletter article to the mailing list, Sunday evening
//
// Published tips go straight into the `tips` collection - the tips index,
// sitemap and card images all render live from it, no deploy needed.

const TIPS_CONTEXT = `You write the tip pages for SuperSpeech (superspeech.biz), an AI speech-writing service. Published tips are genuinely useful standalone reads - the kind someone Googling "how do I write a best man speech" is glad they found. Voice: warm, witty, practical, British. Every tip ends by making the reader feel they could do it themselves - but subtly glad a service exists.`;

async function existingTipTitles() {
  try {
    const snap = await db.collection('tips').get();
    return snap.docs.map(d => d.data().title).filter(Boolean);
  } catch { return []; }
}

async function publishTip() {
  const existing = await existingTipTitles();
  const raw = await aiService.generateSocialCopy(
    `${TIPS_CONTEXT}

Existing tip titles (do NOT repeat or near-duplicate these):
${existing.map(t => `- ${t}`).join('\n') || '(none yet)'}

Write ONE new tip article. Pick a topic with real search demand: a specific occasion/role, a classic problem ("opening lines", "how long", "what not to say"), or a delivery technique.

Reply with ONLY JSON:
{
  "title": "page title, e.g. 'Best Man Speech: 7 Openers That Always Work'",
  "body": "the article as PLAIN TEXT, 450-650 words. Separate paragraphs with a blank line. No markdown, no HTML - plain prose with occasional short lists written as plain lines starting with a dash."
}`,
    { maxTokens: 1400, temperature: 0.85 });

  const m = String(raw).match(/\{[\s\S]*\}/);
  const tip = m ? JSON.parse(m[0]) : null;
  if (!tip?.title || !tip?.body) throw new Error('tip generation returned no usable JSON');
  if (existing.some(t => t.toLowerCase() === tip.title.toLowerCase()))
    throw new Error('duplicate title, skipped');

  await db.collection('tips').add({
    title: tip.title.trim(),
    body: tip.body.trim(),
    published: true,
    source: 'weekly-generator',
    createdAt: new Date().toISOString()
  });
  await db.collection('marketingActions').add({
    date: new Date().toISOString().slice(0, 10),
    type: 'tip_published',
    title: tip.title.trim(),
    emailSent: false,
    createdAt: new Date().toISOString()
  });
  return { title: tip.title };
}

// Sunday-evening newsletter: one fun, colourful few-minute read for the
// mailing list. Inner HTML is allowed to be playful (coloured pull-boxes,
// emoji section headers) inside the branded campaign wrapper.
async function sendWeeklyNewsletter() {
  const existing = await existingTipTitles(); // for internal links
  const raw = await aiService.generateSocialCopy(
    `${TIPS_CONTEXT}

Write this week's SuperSpeech newsletter for the mailing list: a fun, warm, genuinely useful read of 3-4 minutes (~350-450 words) about speech-writing - a memorable opener that worked, a wedding-speech disaster to avoid, a rhetorical trick anyone can steal, that kind of thing. End with ONE gentle nudge toward superspeech.biz (a tip link or "let us write it"). Use an emoji or two in section headings for charm, not chaos.

Reply with ONLY JSON:
{
  "subject": "short, intriguing subject line",
  "text": "the article as PLAIN TEXT (paragraphs separated by blank lines)",
  "html": "the same article as colourful inline-styled HTML: <p> paragraphs (line-height 1.7), one or two <h3> emoji section headers, and at least one pull-quote or highlight box like <div style=\"background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:8px;margin:16px 0;\">...</div>. No outer html/body/wrapper tags - we provide the shell."
}`,
    { maxTokens: 2000, temperature: 0.9 });

  const m = String(raw).match(/\{[\s\S]*\}/);
  const nl = m ? JSON.parse(m[0]) : null;
  if (!nl?.subject || !nl?.html || !nl?.text) throw new Error('newsletter generation returned no usable JSON');

  const res = await mailingListService.sendCampaign({
    subject: nl.subject, html: nl.html, text: nl.text
  });
  await db.collection('marketingActions').add({
    date: new Date().toISOString().slice(0, 10),
    type: 'newsletter',
    title: nl.subject,
    detail: { sent: res.sent, failed: res.failed },
    emailSent: true,
    createdAt: new Date().toISOString()
  });
  return { subject: nl.subject, sent: res.sent, failed: res.failed };
}

module.exports = { publishTip, sendWeeklyNewsletter };
