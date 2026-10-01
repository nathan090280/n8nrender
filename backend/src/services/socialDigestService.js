const axios = require('axios');
const emailService = require('./emailService');
const { db } = require('../config/firebase');
const { londonNow } = require('../utils/londonTime');
const statsService = require('./statsService');

// Nightly digest to hello@superspeech.biz: followers, today's interactions,
// and what we posted. Every platform call is defensive - a missing scope or
// failed API shows as "unavailable" rather than sinking the email.

const GRAPH = 'https://graph.facebook.com/v21.0';
const DIGEST_TO = 'hello@superspeech.biz';

// Is an ISO timestamp from "today" in London?
function isTodayLondon(iso) {
  if (!iso) return false;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(iso)) === londonNow().date;
}

async function todaysPosts() {
  try {
    const snap = await db.collection('socialPosts')
      .orderBy('createdAt', 'desc').limit(5).get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => isTodayLondon(p.createdAt));
  } catch { return []; }
}

async function facebookMetrics(postIds) {
  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.META_PAGE_TOKEN;
  const out = {};
  const page = await axios.get(`${GRAPH}/${pageId}`, {
    params: { fields: 'followers_count,fan_count,name', access_token: token }, timeout: 15000 });
  out.followers = page.data.followers_count ?? page.data.fan_count;

  try {
    const ins = await axios.get(`${GRAPH}/${pageId}/insights`, {
      params: { metric: 'page_impressions,page_engaged_users', period: 'day', access_token: token }, timeout: 15000 });
    for (const m of ins.data.data || []) {
      const today = (m.values || []).find(v => isTodayLondon(v.end_time));
      if (m.name === 'page_impressions') out.impressions = today?.value;
      if (m.name === 'page_engaged_users') out.engaged = today?.value;
    }
  } catch { out.insightsUnavailable = true; }

  // Today's post interactions
  let likes = 0, comments = 0;
  for (const pid of postIds) {
    try {
      const p = await axios.get(`${GRAPH}/${pid}`, {
        params: { fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0)', access_token: token }, timeout: 15000 });
      likes += p.data.likes?.summary?.total_count || 0;
      comments += p.data.comments?.summary?.total_count || 0;
    } catch { /* post lookup failed - skip */ }
  }
  if (postIds.length) { out.postLikes = likes; out.postComments = comments; }
  return out;
}

async function instagramMetrics(mediaIds) {
  const igId = process.env.IG_USER_ID;
  const token = process.env.META_PAGE_TOKEN;
  const out = {};
  const acct = await axios.get(`${GRAPH}/${igId}`, {
    params: { fields: 'followers_count,media_count', access_token: token }, timeout: 15000 });
  out.followers = acct.data.followers_count;

  let likes = 0, comments = 0;
  for (const mid of mediaIds) {
    try {
      const m = await axios.get(`${GRAPH}/${mid}`, {
        params: { fields: 'like_count,comments_count', access_token: token }, timeout: 15000 });
      likes += m.data.like_count || 0;
      comments += m.data.comments_count || 0;
    } catch { /* skip */ }
  }
  if (mediaIds.length) { out.postLikes = likes; out.postComments = comments; }
  return out;
}

async function mastodonMetrics() {
  const host = process.env.MASTODON_INSTANCE || 'mastodon.social';
  const headers = { Authorization: `Bearer ${process.env.MASTODON_TOKEN}` };
  const out = {};
  const acct = await axios.get(`https://${host}/api/v1/accounts/verify_credentials`, { headers, timeout: 15000 });
  out.followers = acct.data.followers_count;
  out.totalPosts = acct.data.statuses_count;

  const notifs = await axios.get(`https://${host}/api/v1/notifications?limit=40`, { headers, timeout: 15000 });
  const today = notifs.data.filter(n => isTodayLondon(n.created_at));
  out.newFollowers = today.filter(n => n.type === 'follow').length;
  out.favourites = today.filter(n => n.type === 'favourite').length;
  out.boosts = today.filter(n => n.type === 'reblog').length;
  out.mentions = today.filter(n => n.type === 'mention').length;
  return out;
}

async function blueskyMetrics() {
  const sess = await axios.post('https://bsky.social/xrpc/com.atproto.server.createSession',
    { identifier: process.env.BSKY_HANDLE, password: process.env.BSKY_APP_PASSWORD }, { timeout: 15000 });
  const token = sess.data.accessJwt;
  const headers = { Authorization: `Bearer ${token}` };
  const out = {};

  const prof = await axios.get('https://bsky.social/xrpc/app.bsky.actor.getProfile',
    { params: { actor: sess.data.did }, headers, timeout: 15000 });
  out.followers = prof.data.followersCount;
  out.totalPosts = prof.data.postsCount;

  const notifs = await axios.get('https://bsky.social/xrpc/app.bsky.notification.listNotifications',
    { params: { limit: 50 }, headers, timeout: 15000 });
  const today = (notifs.data.notifications || []).filter(n => isTodayLondon(n.indexedAt));
  out.newFollowers = today.filter(n => n.reason === 'follow').length;
  out.likes = today.filter(n => n.reason === 'like').length;
  out.reposts = today.filter(n => n.reason === 'repost').length;
  out.replies = today.filter(n => n.reason === 'reply' || n.reason === 'mention').length;
  return out;
}

// Count docs in a collection whose createdAt falls on today (London).
async function countToday(collection, field = 'createdAt') {
  try {
    const snap = await db.collection(collection).limit(500).get();
    return snap.docs.filter(d => isTodayLondon(d.data()[field])).length;
  } catch { return null; }
}

async function siteAndBusiness() {
  const [views, orders, speeches, signups, contacts, tipsCount] = await Promise.all([
    statsService.getToday(),
    countToday('questionnaires'),
    countToday('speeches'),
    countToday('mailingList'),
    countToday('contactInteractions'),
    db.collection('tips').where('published', '==', true).get().then(s => s.size).catch(() => null)
  ]);
  return {
    tipPageViews: views.tipPageViews || 0,
    tipsIndexViews: views.tipsIndexViews || 0,
    cardFetches: views.cardFetches || 0,
    newOrders: orders,
    speechesGenerated: speeches,
    newMailingListSignups: signups,
    contactMessages: contacts,
    publishedTips: tipsCount
  };
}

function row(label, m, extra = '') {
  if (!m) return `<tr><td style="padding:8px 12px;border:1px solid #e2e8f0;"><b>${label}</b></td><td style="padding:8px 12px;border:1px solid #e2e8f0;" colspan="3">unavailable</td></tr>`;
  const cells = Object.entries(m).map(([k, v]) =>
    `<div><span style="color:#64748b;">${k}</span>: <b>${v === true ? 'yes' : v}</b></div>`).join('');
  return `<tr><td style="padding:8px 12px;border:1px solid #e2e8f0;vertical-align:top;"><b>${label}</b></td><td style="padding:8px 12px;border:1px solid #e2e8f0;" colspan="3">${cells}${extra}</td></tr>`;
}

async function collectAndSend() {
  const posts = await todaysPosts();
  const fbIds = posts.map(p => p.results?.facebook?.id).filter(Boolean);
  const igIds = posts.map(p => p.results?.instagram?.id).filter(Boolean);

  const [fb, ig, masto, bsky, site] = await Promise.all([
    facebookMetrics(fbIds).catch(e => ({ error: e.response?.data?.error?.message || e.message })),
    instagramMetrics(igIds).catch(e => ({ error: e.response?.data?.error?.message || e.message })),
    mastodonMetrics().catch(e => ({ error: e.response?.data?.error?.message || e.message })),
    blueskyMetrics().catch(e => ({ error: e.response?.data?.error?.message || e.message })),
    siteAndBusiness().catch(e => ({ error: e.message }))
  ]);

  const postedHtml = posts.length
    ? posts.map(p => `<li><b>${p.concept || 'post'}</b> <span style="color:#64748b;">(${p.category || ''})</span></li>`).join('')
    : '<li>No posts today</li>';

  const html = `<html><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1e293b;">
<h2 style="color:#2563eb;">SuperSpeech Daily Social Digest</h2>
<p style="color:#64748b;">${londonNow().date} (UK time)</p>
<h3>Posted today</h3><ul>${postedHtml}</ul>
<h3>Channels</h3>
<table style="border-collapse:collapse;width:100%;">
<tr style="background:#f1f5f9;"><th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left;">Channel</th><th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left;" colspan="3">Today's numbers</th></tr>
${row('Facebook', fb)}
${row('Instagram', ig)}
${row('Mastodon', masto)}
${row('Bluesky', bsky)}
${row('Site & Business', site)}
</table>
<p style="color:#94a3b8;font-size:12px;margin-top:24px;">Sent automatically by the SuperSpeech social engine. Gaps mean the platform API didn't expose the metric (often missing scopes) - not necessarily zero.</p>
</body></html>`;

  await emailService.sendSocialDigest(DIGEST_TO, html);
  return { fb, ig, masto, bsky, site, posts: posts.length };
}

module.exports = { collectAndSend };
