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
// Marketing Executive: one autonomous action per day, daytime slot.
const MARKETING_HOUR = parseInt(process.env.MARKETING_HOUR || '11', 10);
const MARKETING_MINUTE = parseInt(process.env.MARKETING_MINUTE || '30', 10);
// Weekly content: new tip pages on these London weekdays, newsletter on Sunday eve.
const TIP_DAYS = (process.env.TIP_DAYS || 'Tue,Fri').split(',').map(s => s.trim());
const TIP_HOUR = parseInt(process.env.TIP_HOUR || '10', 10);
const NEWSLETTER_DAY = process.env.NEWSLETTER_DAY || 'Sun';
const NEWSLETTER_HOUR = parseInt(process.env.NEWSLETTER_HOUR || '19', 10);
const NEWSLETTER_MINUTE = parseInt(process.env.NEWSLETTER_MINUTE || '0', 10);
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
    bluesky: post.captions?.short,
    pinterest: post.captions?.short
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
      platforms: [p],
      title: post.cardHeadline,
      link: 'https://superspeech.biz/tips'
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

async function alreadyMarketedToday(londonDate) {
  try {
    const doc = await db.collection('marketingLog').doc(londonDate).get();
    return doc.exists;
  } catch { return false; }
}

async function jobRanToday(name, londonDate) {
  try {
    const doc = await db.collection('jobLog').doc(`${name}_${londonDate}`).get();
    return doc.exists;
  } catch { return false; }
}

async function markJobRan(name, londonDate, result) {
  await db.collection('jobLog').doc(`${name}_${londonDate}`)
    .set({ ranAt: new Date().toISOString(), result }).catch(() => {});
}

// Atomic lock so two ticks don't both start the marketing agent while
// runDaily is still thinking (it can take >1 minute because of Claude).
async function acquireMarketingLock(londonDate) {
  const ref = db.collection('marketingLog').doc(londonDate);
  try {
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (snap.exists) throw new Error('already locked');
      t.set(ref, { startedAt: new Date().toISOString(), status: 'running' });
    });
    return true;
  } catch (e) {
    if (e.message === 'already locked') return false;
    throw e;
  }
}

async function tick() {
  const now = londonNow();

  // Seed Threads token tracking + refresh Pinterest token once a day
  if (now.hour === DIGEST_HOUR && now.minute === DIGEST_MINUTE) {
    socialPostService.trackThreadsToken().catch(() => {});
    socialPostService.refreshPinterestTokenIfNeeded().catch(() => {});
  }

  // Marketing Executive daily action at 11:30 UK (default) - follow-up
  // sweep runs inside it and doesn't count against the one-a-day.
  if (now.hour === MARKETING_HOUR && now.minute >= MARKETING_MINUTE) {
    const locked = await acquireMarketingLock(now.date).catch(() => false);
    if (!locked) return;
    try {
      const agent = require('./marketingAgentService');
      const result = await agent.runDaily();
      await db.collection('marketingLog').doc(now.date).update({
        finishedAt: new Date().toISOString(),
        status: 'done',
        result
      });
      console.log(`[Marketing] Daily run done: ${result.action || 'none'}`);
    } catch (e) {
      console.error('[Marketing] Daily run failed:', e.message);
    }
    return;
  }

  // Tip generator: new published tip on TIP_DAYS at ~TIP_HOUR UK
  if (TIP_DAYS.includes(now.weekday) && now.hour === TIP_HOUR && !(await jobRanToday('tip', now.date))) {
    try {
      const result = await require('./weeklyContentService').publishTip();
      await markJobRan('tip', now.date, result);
      console.log(`[Tips] Published "${result.title}"`);
    } catch (e) {
      console.error('[Tips] generation failed:', e.message);
      await markJobRan('tip', now.date, { error: e.message });
    }
    return;
  }

  // Sunday-evening newsletter article to the mailing list
  if (now.weekday === NEWSLETTER_DAY && now.hour === NEWSLETTER_HOUR && now.minute >= NEWSLETTER_MINUTE
      && !(await jobRanToday('newsletter', now.date))) {
    try {
      const result = await require('./weeklyContentService').sendWeeklyNewsletter();
      await markJobRan('newsletter', now.date, result);
      console.log(`[Newsletter] Sent "${result.subject}" to ${result.sent}`);
    } catch (e) {
      console.error('[Newsletter] failed:', e.message);
      await markJobRan('newsletter', now.date, { error: e.message });
    }
    return;
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
  console.log(`[Social] Armed - posts ${POST_HOUR}:00, digest ${DIGEST_HOUR}:${String(DIGEST_MINUTE).padStart(2, '0')}, marketing ${MARKETING_HOUR}:${String(MARKETING_MINUTE).padStart(2, '0')}, tips ${TIP_DAYS.join('+')} ${TIP_HOUR}:00, newsletter ${NEWSLETTER_DAY} ${NEWSLETTER_HOUR}:${String(NEWSLETTER_MINUTE).padStart(2, '0')} Europe/London`);
  setInterval(tick, TICK_MS);
  tick(); // covers the case where the server boots inside the posting hour
}

module.exports = { start, runPostJob };
