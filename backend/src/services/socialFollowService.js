const axios = require('axios');
const { db } = require('../config/firebase');

// Daily follow sweep: find wedding-adjacent accounts on Mastodon + Bluesky
// and follow them - the follow-back channel is one of the few organic
// growth levers the APIs actually allow. Hard daily cap, dedupe so we
// never follow the same account twice, everything logged to Firestore.

const DAILY_LIMIT = parseInt(process.env.SOCIAL_FOLLOW_LIMIT || '100', 10);

// Rotating search pool - a few are picked per sweep so follows spread
// across the community instead of hammering one keyword.
const QUERIES = [
  'wedding speech', 'best man speech', 'groom speech', 'maid of honor',
  'wedding planner', 'wedding planning', 'wedding photographer',
  'wedding celebrant', 'father of the bride', 'wedding toast',
  'engaged', 'wedding venue'
];

async function alreadyFollowed(platform, actorId) {
  const snap = await db.collection('socialFollows')
    .where('platform', '==', platform)
    .where('actorId', '==', String(actorId)).limit(1).get();
  return !snap.empty;
}

async function recordFollow(platform, actor) {
  await db.collection('socialFollows').add({
    platform,
    actorId: String(actor.id),
    handle: actor.handle || actor.acct || '',
    displayName: actor.displayName || actor.display_name || '',
    followedAt: new Date().toISOString()
  });
}

// --- Bluesky -----------------------------------------------------------------

async function blueskySession() {
  const res = await axios.post(
    'https://bsky.social/xrpc/com.atproto.server.createSession',
    { identifier: process.env.BSKY_HANDLE, password: process.env.BSKY_APP_PASSWORD },
    { timeout: 10000 });
  return res.data; // { accessJwt, did }
}

async function followBluesky(queries, limit) {
  if (!process.env.BSKY_HANDLE || !process.env.BSKY_APP_PASSWORD) return 0;
  const sess = await blueskySession();
  const auth = { Authorization: `Bearer ${sess.accessJwt}` };
  let count = 0;
  for (const query of queries) {
    if (count >= limit) break;
    const found = await axios.get(
      `https://bsky.social/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(query)}&limit=100`,
      { headers: auth, timeout: 10000 });
    for (const actor of (found.data.actors || [])) {
      if (count >= limit) break;
      if (actor.did === sess.did) continue; // never follow ourselves
      if (await alreadyFollowed('bluesky', actor.did)) continue;
      try {
        await axios.post('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
          repo: sess.did,
          collection: 'app.bsky.graph.follow',
          record: {
            $type: 'app.bsky.graph.follow',
            subject: actor.did,
            createdAt: new Date().toISOString()
          }
        }, { headers: auth, timeout: 10000 });
        await recordFollow('bluesky', { id: actor.did, handle: actor.handle, displayName: actor.displayName });
        count++;
      } catch (e) {
        console.warn('[Follows] bluesky follow failed:', actor.handle, e.message);
      }
    }
  }
  return count;
}

// --- Mastodon ----------------------------------------------------------------

async function followMastodon(queries, limit) {
  const host = process.env.MASTODON_INSTANCE || 'mastodon.social';
  const token = process.env.MASTODON_TOKEN;
  if (!token) return 0;
  const auth = { Authorization: `Bearer ${token}` };
  let count = 0;
  for (const query of queries) {
    if (count >= limit) break;
    const found = await axios.get(
      `https://${host}/api/v1/accounts/search?q=${encodeURIComponent(query)}&limit=40&resolve=true`,
      { headers: auth, timeout: 10000 });
    for (const acct of (found.data || [])) {
      if (count >= limit) break;
      if (await alreadyFollowed('mastodon', acct.id)) continue;
      try {
        await axios.post(`https://${host}/api/v1/accounts/${acct.id}/follow`,
          {}, { headers: auth, timeout: 10000 });
        await recordFollow('mastodon', { id: acct.id, acct: acct.acct, displayName: acct.display_name });
        count++;
      } catch (e) {
        console.warn('[Follows] mastodon follow failed:', acct.acct, e.message);
      }
    }
  }
  return count;
}

// --- sweep --------------------------------------------------------------------

// Follow up to DAILY_LIMIT accounts across both platforms, split roughly
// evenly, rotating through the query pool. Returns a per-platform tally.
async function runFollowSweep() {
  const perPlatform = Math.floor(DAILY_LIMIT / 2);
  // Each platform works through 4 rotating queries until it hits its cap.
  const dayIndex = Math.floor(Date.now() / 86400000) % QUERIES.length;
  const queries = [0, 1, 2, 3].map(i => QUERIES[(dayIndex + i) % QUERIES.length]);
  const result = { bluesky: 0, mastodon: 0 };
  try {
    result.bluesky = await followBluesky(queries, perPlatform);
  } catch (e) { console.warn('[Follows] bluesky sweep failed:', e.message); }
  try {
    result.mastodon = await followMastodon(queries, perPlatform);
  } catch (e) { console.warn('[Follows] mastodon sweep failed:', e.message); }
  console.log(`[Follows] followed ${result.bluesky} bluesky + ${result.mastodon} mastodon (queries: ${queries.join(', ')})`);
  return result;
}

module.exports = { runFollowSweep };
