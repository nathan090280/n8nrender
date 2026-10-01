const fs = require('fs');
const path = require('path');
const aiService = require('./aiService');
const { db } = require('../config/firebase');

// The owner's content bible - loaded from the repo so it can be edited like code.
const GUIDE = fs.readFileSync(
  path.join(__dirname, '../content/social-content-guide.md'), 'utf8'
);

// Recent post history keeps the engine from repeating itself.
async function getRecentConcepts(limit = 20) {
  try {
    const snap = await db.collection('socialPosts')
      .orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map(d => d.data().concept).filter(Boolean);
  } catch { return []; }
}

async function recordPost(concept, category, results) {
  await db.collection('socialPosts').add({
    concept, category, results,
    createdAt: new Date().toISOString()
  });
}

// Generates one post concept + a card + per-platform captions, all steered
// by the owner's guide. Returns JSON {concept, category, card, captions}.
async function generatePost({ topic, category } = {}) {
  const recent = await getRecentConcepts();

  const prompt = `${GUIDE}

---
You are now generating ONE social post for SuperSpeech following the guide above.

Requirements:
- Pick a content category that fits the ~50/20/15/10/5 mix
- ${category ? `Use this category: ${category}` : 'You choose the category'}
- ${topic ? `Topic given: ${topic}` : 'You choose the specific angle'}
- Do NOT repeat these recently-used concepts: ${recent.join(' | ') || '(none yet)'}
- The visual is a branded square card: a short headline + a punchy subtitle, nothing else (max ~6 words headline, ~15 words sub)
- Write a caption per platform adapted to its style (guide section 20): facebook, instagram, threads-style short version used for mastodon and bluesky too
- Instagram caption should include 5-8 relevant hashtags; other platforms max 2
- Include a light CTA where the guide calls for it - not every post needs one

Reply with ONLY valid JSON, no markdown fences:
{
  "concept": "one-line description of the post idea",
  "category": "guide category name",
  "cardHeadline": "short punchy card headline",
  "cardSub": "supporting card subline",
  "captions": {
    "facebook": "...",
    "instagram": "...",
    "short": "..." 
  }
}`;

  const text = await aiService.generateSocialCopy(prompt);
  const json = text.replace(/```json|```/g, '').trim();
  return JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1));
}

module.exports = { generatePost, recordPost, getRecentConcepts };
