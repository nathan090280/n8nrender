const contentEngine = require('./contentEngine');
const socialPostService = require('./socialPostService');
const { db } = require('../config/firebase');
const { londonNow } = require('../utils/londonTime');

// Daily social poster. One branded card post per day at 18:00 UK time,
// following the owner's content guide (src/content/social-content-guide.md).
// Quality over volume - a single well-adapted post, not a flood.
//
// Dedupe: before firing, checks Firestore for a post already published today
// (London date) so a Render restart can never double-post.
//
// Env: SOCIAL_POST_HOUR (default 18, Europe/London) - set to e.g. 9 to move
// the daily slot without a code change.

const POST_HOUR = parseInt(process.env.SOCIAL_POST_HOUR || '18', 10);
const DIGEST_HOUR = parseInt(process.env.SOCIAL_DIGEST_HOUR || '21', 10);
const DIGEST_MINUTE = parseInt(process.env.SOCIAL_DIGEST_MINUTE || '30', 10);
const TICK_MS = 60 * 1000;

// Full pipeline: guide -> Claude -> card -> publish -> Firestore record.
// Shared by the scheduler tick and the /api/webhooks/social-post endpoint.
// `manual` mode skips generation: {captions:{...}, cardHeadline, cardSub} as-is.
async function runPostJob({ platforms, topic, category, dryRun, manual } = {}) {
  const post = manual || await contentEngine.generatePost({ topic, category });

  // Card media URLs point at the Render origin - platforms fetch the image
  // themselves, so no Netlify proxy dependency.
  const cardUrl = (ext) =>
    `https://superspeech-backend.onrender.com/public/media/card.${ext}?h=${encodeURIComponent(post.cardHeadline)}&s=${encodeURIComponent(post.cardSub || '')}`;

  const wanted = platforms && platforms.length ? platforms
    : Object.keys(socialPostService.POSTERS);

  // Manual mode may pass captions already keyed per platform; generated
  // posts get mapped (fb/ig distinct, "short" shared for mastodon+bluesky).
  const captions = post.captionsByPlatform || {
    facebook: post.captions?.facebook,
    instagram: post.captions?.instagram,
    threads: post.captions?.short,
    mastodon: post.captions?.short,
    bluesky: post.captions?.short
  };

  const result = {
    success: true,
    concept: post.concept,
    category: post.category,
    card: { headline: post.cardHeadline, sub: post.cardSub },
    cardPreviewPng: cardUrl('png'),
    captions,
    dryRun: !!dryRun
  };

  if (dryRun) return result;

  // Instagram's media container requires a jpeg URL; everyone else takes png.
  const results = {};
  for (const p of wanted) {
    const imageUrl = cardUrl(p === 'instagram' ? 'jpg' : 'png');
    const r = await socialPostService.publishPost({
      captions: { [p]: captions[p] },
      imageUrl,
      platforms: [p]
    });
    results[p] = r[p];
  }

  result.results = results;
  await contentEngine.recordPost(post.concept, post.category, results);
  return result;
}

async function alreadyPostedToday(londonDate) {
  try {
    const snap = await db.collection('socialPosts')
      .orderBy('createdAt', 'desc').limit(1).get();
    if (snap.empty) return false;
    const createdAt = snap.docs[0].data().createdAt;
    // createdAt is an ISO string - compare its London date to today's
    const postedDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(createdAt));
    return postedDate === londonDate;
  } catch { return false; }
}

async function alreadySentDigestToday(londonDate) {
  try {
    const doc = await db.collection('digestLog').doc(londonDate).get();
    return doc.exists;
  } catch { return false; }
}

async function tick() {
  const now = londonNow();

  // Seed Threads token expiry tracking once a day
  if (now.hour === DIGEST_HOUR && now.minute === DIGEST_MINUTE) {
    socialPostService.trackThreadsToken().catch(() => {});
  }

  // Nightly digest email at 21:30 UK
  if (now.hour === DIGEST_HOUR && now.minute >= DIGEST_MINUTE && !(await alreadySentDigestToday(now.date))) {
    try {
      const digest = require('./socialDigestService'); // lazy - avoids a require cycle
      const result = await digest.collectAndSend();
      await db.collection('digestLog').doc(now.date).set({ sentAt: new Date().toISOString(), result });
      console.log(`[Social] Daily digest emailed for ${now.date}`);
    } catch (e) {
      console.error('[Social] Digest failed:', e.message);
    }
    return;
  }

  if (now.hour !== POST_HOUR) return;
  if (await alreadyPostedToday(now.date)) return;

  console.log(`[Social] Daily post firing at ${now.hour}:${String(now.minute).padStart(2, '0')} UK`);
  try {
    const result = await runPostJob({});
    const ok = Object.entries(result.results || {}).filter(([, r]) => r.success).map(([p]) => p);
    const failed = Object.entries(result.results || {}).filter(([, r]) => !r.success).map(([p]) => p);
    console.log(`[Social] Posted "${result.concept}" -> ok: ${ok.join(', ') || 'none'}${failed.length ? ` | failed: ${failed.join(', ')}` : ''}`);
  } catch (e) {
    console.error('[Social] Daily post failed:', e.message);
  }
}

function start() {
  console.log(`[Social] Daily poster armed - posts at ${POST_HOUR}:00, digest at ${DIGEST_HOUR}:${String(DIGEST_MINUTE).padStart(2, '0')} Europe/London`);
  setInterval(tick, TICK_MS);
  tick(); // covers the case where the server boots inside the posting hour
}

module.exports = { start, runPostJob };
