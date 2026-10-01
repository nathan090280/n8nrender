const axios = require('axios');
const { db } = require('../config/firebase');
const emailService = require('./emailService');
const aiService = require('./aiService');

// Watches Reddit for "help me write a speech" posts, drafts a reply with AI,
// stores the lead in Firestore and emails Nathan. Replies are never posted
// automatically - Reddit bans drive-by promo, so a human hits submit.
//
// Two source types:
//   1. Reddit API search (needs REDDIT_CLIENT_ID/SECRET + bot USERNAME/PASSWORD)
//   2. Google Alerts RSS feeds (REDDIT_ALERT_FEEDS, comma-separated) - works
//      with zero Reddit credentials; Google indexes the posts for us.

const POLL_INTERVAL_MS = parseInt(process.env.REDDIT_POLL_INTERVAL_MS) || 15 * 60 * 1000;
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'SuperSpeechListener/1.0';
const NOTIFY_EMAIL = process.env.REDDIT_NOTIFY_EMAIL || 'hello@superspeech.biz';
const MAX_NEW_PER_CYCLE = 5;              // never email-bomb, even on a busy cycle
const MAX_POST_AGE_MS = 48 * 3600 * 1000; // only alert on posts < 48h old

const QUERIES = [
  // wedding
  '"best man speech"', '"groom speech"', '"bride speech"',
  '"father of the bride speech"', '"mother of the bride speech"',
  '"father of the groom speech"', '"mother of the groom speech"',
  '"maid of honor speech"', '"maid of honour speech"',
  '"wedding speech" help', '"wedding toast"', '"wedding vows" help write',
  '"vow renewal" speech', '"engagement speech"',
  // remembrance
  '"eulogy" write', '"funeral speech"', '"celebration of life" speech',
  '"memorial speech"', '"tribute" speech write',
  // corporate / professional
  '"keynote speech"', '"retirement speech"', '"farewell speech"',
  '"leaving speech" work', '"acceptance speech" award',
  '"award speech"', '"company anniversary" speech',
  '"welcome speech"', '"thank you speech"',
  // milestone
  '"birthday speech"', '"21st speech"', '"30th speech"', '"40th speech"',
  '"50th speech"', '"60th speech"', '"70th speech"',
  '"graduation speech"', '"commencement speech"', '"valedictorian" speech',
  '"bar mitzvah" speech', '"bat mitzvah" speech', '"anniversary speech"',
  '"baby shower" speech', '"christening speech"',
  // generic help-seeking
  '"help me write" speech', '"write my speech"', '"how to write a speech"',
  '"speech writer"', '"need help" "speech" wedding',
  '"best man speech" panic', '"speech" "dont know what to say"',
  '"public speaking" wedding speech'
];

const RSS_FEEDS = (process.env.REDDIT_ALERT_FEEDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const REQUEST_DELAY_MS = 2500; // stay well under rate limits

let timer = null;
let polling = false;
let oauthToken = null;
let oauthExpiresAt = 0;

// ---------------------------------------------------------------------------
// Reddit API path (oauth.reddit.com - allowed from datacenter IPs once the
// script app is approved). Public www.reddit.com JSON 403s on Render IPs.
// ---------------------------------------------------------------------------
async function getAccessToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (oauthToken && Date.now() < oauthExpiresAt) return oauthToken;

  const user = process.env.REDDIT_USERNAME;
  const pass = process.env.REDDIT_PASSWORD;
  const grant = (user && pass)
    ? `grant_type=password&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
    : 'grant_type=client_credentials';

  const res = await axios.post('https://www.reddit.com/api/v1/access_token', grant, {
    auth: { username: id, password: secret },
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });
  oauthToken = res.data.access_token;
  oauthExpiresAt = Date.now() + (res.data.expires_in - 60) * 1000;
  return oauthToken;
}

async function searchReddit(query) {
  const token = await getAccessToken().catch(() => null);
  if (!token) return []; // no creds = no Reddit API; RSS feeds carry the load
  const res = await axios.get('https://oauth.reddit.com/search.json', {
    params: { q: query, sort: 'new', limit: 25 },
    headers: { 'User-Agent': USER_AGENT, Authorization: `Bearer ${token}` },
    timeout: 15000
  });
  return (res.data?.data?.children || []).map(c => c.data);
}

function redditPostToLead(post) {
  return {
    postId: `reddit_${post.id}`,
    subreddit: post.subreddit,
    title: post.title,
    body: (post.selftext || '').slice(0, 3000),
    permalink: post.permalink,
    url: `https://www.reddit.com${post.permalink}`,
    author: post.author,
    createdMs: post.created_utc * 1000,
    source: 'reddit-api'
  };
}

function isAlertable(post) {
  if (!post || !post.id || post.over_18 || post.removed_by_category) return false;
  if (!post.author || post.author === '[deleted]') return false;
  return Date.now() - post.created_utc * 1000 < MAX_POST_AGE_MS;
}

// ---------------------------------------------------------------------------
// Google Alerts RSS path - no credentials needed. Google Alerts emits Atom
// entries whose <link href> wraps the real URL in google.com/url?url=...
// ---------------------------------------------------------------------------
function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function realUrl(googleUrl) {
  try {
    const m = String(googleUrl).match(/[?&]url=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : googleUrl;
  } catch { return googleUrl; }
}

async function fetchRssFeed(feedUrl) {
  const res = await axios.get(feedUrl, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 20000
  });
  const xml = res.data || '';
  const items = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const e = m[1];
    const pick = (re) => { const x = e.match(re); return x ? decodeXml(x[1].trim()) : ''; };
    const link = realUrl(pick(/<link[^>]*href="([^"]+)"/));
    items.push({
      postId: `rss_${Buffer.from(link).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`,
      subreddit: (link.match(/reddit\.com\/r\/([^/]+)/) || [null, 'web'])[1],
      title: pick(/<title[^>]*>([\s\S]*?)<\/title>/),
      body: pick(/<content[^>]*>([\s\S]*?)<\/content>/).slice(0, 3000),
      permalink: link,
      url: link,
      author: pick(/<name>([\s\S]*?)<\/name>/),
      createdMs: Date.parse(pick(/<updated>([^<]+)<\/updated>/)) || Date.now(),
      source: 'google-alerts-rss'
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Shared pipeline: dedupe -> AI draft -> Firestore -> email Nathan
// ---------------------------------------------------------------------------
async function processLead(lead) {
  const ref = db.collection('redditLeads').doc(lead.postId);
  const existing = await ref.get();
  if (existing.exists) return false;

  const draftReply = await aiService.generateRedditReply(lead.title, lead.body, lead.subreddit);

  await ref.set({
    ...lead,
    draftReply: draftReply || '(AI draft unavailable - read the post and reply manually)',
    status: 'new',
    createdAt: new Date().toISOString()
  });
  lead.draftReply = draftReply;
  await emailService.sendRedditLeadAlert(NOTIFY_EMAIL, lead);
  console.log(`✓ Lead saved + emailed [${lead.source}]: ${lead.title.slice(0, 60)}`);
  return true;
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  let newCount = 0;

  try {
    // Source 1: Reddit API search (skipped automatically until creds exist)
    for (const query of QUERIES) {
      if (newCount >= MAX_NEW_PER_CYCLE) break;
      let posts;
      try { posts = await searchReddit(query); }
      catch (e) { console.warn(`Reddit search failed for ${query}: ${e.message}`); continue; }

      for (const post of posts) {
        if (newCount >= MAX_NEW_PER_CYCLE) break;
        if (!isAlertable(post)) continue;
        try { if (await processLead(redditPostToLead(post))) newCount++; }
        catch (e) { console.warn(`Lead processing failed (${post.id}): ${e.message}`); }
      }
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }

    // Source 2: Google Alerts RSS feeds
    for (const feedUrl of RSS_FEEDS) {
      if (newCount >= MAX_NEW_PER_CYCLE) break;
      let items;
      try { items = await fetchRssFeed(feedUrl); }
      catch (e) { console.warn(`RSS feed failed (${feedUrl.slice(0, 60)}): ${e.message}`); continue; }

      for (const lead of items) {
        if (newCount >= MAX_NEW_PER_CYCLE) break;
        if (!lead.title || !lead.url) continue;
        if (Date.now() - lead.createdMs > 7 * 24 * 3600 * 1000) continue; // alerts lag; allow a week
        try { if (await processLead(lead)) newCount++; }
        catch (e) { console.warn(`RSS lead failed: ${e.message}`); }
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (newCount) console.log(`Lead sweep: ${newCount} new lead(s)`);
  } catch (error) {
    console.error('Lead listener sweep failed:', error.message);
  } finally {
    polling = false;
  }
}

function start() {
  if (timer) return;
  console.log(`Lead listener started - polling every ${POLL_INTERVAL_MS / 60000} min, alerts to ${NOTIFY_EMAIL} (reddit api: ${process.env.REDDIT_CLIENT_ID ? 'configured' : 'no creds'}, rss feeds: ${RSS_FEEDS.length})`);
  // First sweep after a short delay so the server finishes booting
  setTimeout(() => pollOnce(), 60 * 1000);
  timer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

module.exports = { start, pollOnce };
