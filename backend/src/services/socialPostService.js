const axios = require('axios');
const { db } = require('../config/firebase');

// Posts to each connected channel. All creds come from env vars set on Render.
// imageUrl must be a PUBLIC URL (the generated card endpoints) - Meta fetches
// the image itself; Mastodon/Bluesky we upload bytes to directly.

const GRAPH = 'https://graph.facebook.com/v21.0';

async function fetchImageBytes(imageUrl) {
  const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
  return { data: Buffer.from(res.data), type: res.headers['content-type'] || 'image/png' };
}

async function postToFacebook(caption, imageUrl) {
  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.META_PAGE_TOKEN;
  const res = await axios.post(`${GRAPH}/${pageId}/photos`, null, {
    params: { url: imageUrl, caption, access_token: token },
    timeout: 30000
  });
  return { platform: 'facebook', id: res.data.id || res.data.post_id };
}

async function postToInstagram(caption, imageUrl) {
  const igId = process.env.IG_USER_ID;
  const token = process.env.META_PAGE_TOKEN;
  // IG media containers expect jpeg URLs; our card endpoint serves .jpg variants
  const container = await axios.post(`${GRAPH}/${igId}/media`, null, {
    params: { image_url: imageUrl, caption, access_token: token },
    timeout: 30000
  });
  const pub = await axios.post(`${GRAPH}/${igId}/media_publish`, null, {
    params: { creation_id: container.data.id, access_token: token },
    timeout: 30000
  });
  return { platform: 'instagram', id: pub.data.id };
}

async function postToMastodon(text, imageUrl) {
  const host = process.env.MASTODON_INSTANCE || 'mastodon.social';
  const token = process.env.MASTODON_TOKEN;
  const headers = { Authorization: `Bearer ${token}` };

  let mediaIds = [];
  if (imageUrl) {
    const img = await fetchImageBytes(imageUrl);
    const boundary = '----mastomedia';
    const filename = imageUrl.endsWith('.jpg') ? 'card.jpg' : 'card.png';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${img.type}\r\n\r\n`),
      img.data,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const up = await axios.post(`https://${host}/api/v2/media`, body, {
      headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      timeout: 30000
    });
    if (up.data.id) mediaIds = [up.data.id];
  }

  const res = await axios.post(`https://${host}/api/v1/statuses`, {
    status: text,
    media_ids: mediaIds
  }, { headers, timeout: 30000 });
  return { platform: 'mastodon', id: res.data.id, url: res.data.url };
}

// Bluesky needs link "facets" for clickable URLs - compute byte offsets
function bskyFacets(text) {
  const facets = [];
  const re = /https?:\/\/[^\s]+/g;
  let m;
  const encoder = new TextEncoder();
  while ((m = re.exec(text))) {
    const start = encoder.encode(text.slice(0, m.index)).length;
    const end = start + encoder.encode(m[0]).length;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }]
    });
  }
  return facets;
}

async function postToBluesky(text, imageUrl) {
  const sess = await axios.post('https://bsky.social/xrpc/com.atproto.server.createSession',
    { identifier: process.env.BSKY_HANDLE, password: process.env.BSKY_APP_PASSWORD },
    { timeout: 15000 });
  const token = sess.data.accessJwt;
  const did = sess.data.did;

  const record = {
    $type: 'app.bsky.feed.post',
    text,
    facets: bskyFacets(text),
    createdAt: new Date().toISOString()
  };

  if (imageUrl) {
    const img = await fetchImageBytes(imageUrl);
    const up = await axios.post('https://bsky.social/xrpc/com.atproto.repo.uploadBlob',
      img.data,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': img.type }, timeout: 30000 });
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: [{ image: up.data.blob, alt: 'SuperSpeech' }]
    };
  }

  const res = await axios.post('https://bsky.social/xrpc/com.atproto.repo.createRecord',
    { repo: did, collection: 'app.bsky.feed.post', record },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 });
  return { platform: 'bluesky', uri: res.data.uri };
}

// Threads user tokens last 60 days but refresh indefinitely. The live token
// lives in Firestore (config/threadsToken) so the self-refresh job can rotate
// it without a redeploy; env var is the bootstrap/fallback.
async function getThreadsToken() {
  try {
    const doc = await db.collection('config').doc('threadsToken').get();
    if (doc.exists && doc.data().token) return doc.data().token;
  } catch { /* fall back to env */ }
  return process.env.THREADS_ACCESS_TOKEN;
}

async function postToThreads(text, imageUrl) {
  const token = await getThreadsToken();
  const uid = process.env.THREADS_USER_ID;
  // Same two-step container model as Instagram
  const container = await axios.post(`https://graph.threads.net/v1.0/${uid}/threads`, null, {
    params: { media_type: 'IMAGE', image_url: imageUrl, text, access_token: token },
    timeout: 30000
  });
  const pub = await axios.post(`https://graph.threads.net/v1.0/${uid}/threads_publish`, null, {
    params: { creation_id: container.data.id, access_token: token },
    timeout: 30000
  });
  return { platform: 'threads', id: pub.data.id };
}

// Threads user tokens last 60 days. th_refresh_token isn't supported for
// Explorer-generated tokens, so instead we track expiry and surface the
// days-left count in the nightly digest - Nathan re-generates via Graph
// Explorer when it gets low.
async function trackThreadsToken() {
  try {
    const doc = await db.collection('config').doc('threadsToken').get();
    const data = doc.exists ? doc.data() : null;
    const current = data?.token || process.env.THREADS_ACCESS_TOKEN;
    if (!current) return;
    if (!data?.expiresAt) {
      // Seed: env token issued today, 60-day life
      await db.collection('config').doc('threadsToken').set({
        token: current,
        expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
        seededAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (e) {
    console.warn('[Social] Threads token tracking failed:', e.message);
  }
}

async function threadsTokenDaysLeft() {
  try {
    const doc = await db.collection('config').doc('threadsToken').get();
    if (!doc.exists || !doc.data().expiresAt) return null;
    return Math.round((new Date(doc.data().expiresAt) - Date.now()) / 86400000);
  } catch { return null; }
}

const POSTERS = {
  facebook: postToFacebook,
  instagram: postToInstagram,
  threads: postToThreads,
  mastodon: postToMastodon,
  bluesky: postToBluesky
};

// platforms: array of keys. captions: {platform: text}. imageUrl: card URL.
// Per-platform failure shouldn't sink the whole post.
async function publishPost({ captions, imageUrl, platforms }) {
  const results = {};
  for (const p of platforms) {
    const poster = POSTERS[p];
    if (!poster) { results[p] = { success: false, error: 'unknown platform' }; continue; }
    try {
      results[p] = { success: true, ...(await poster(captions[p] || captions.default || '', imageUrl)) };
    } catch (e) {
      results[p] = { success: false, error: e.response?.data?.error?.message || e.response?.data?.error_description || e.message };
    }
  }
  return results;
}

module.exports = { publishPost, POSTERS, trackThreadsToken, threadsTokenDaysLeft, getThreadsToken };
