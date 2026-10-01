const axios = require('axios');
const { db } = require('../config/firebase');
const emailService = require('./emailService');
const aiService = require('./aiService');

// Watches Reddit for "help me write a speech" posts, drafts a reply with AI,
// stores the lead in Firestore and emails Nathan. Replies are never posted
// automatically - Reddit bans drive-by promo, so a human hits submit.

const POLL_INTERVAL_MS = parseInt(process.env.REDDIT_POLL_INTERVAL_MS) || 6 * 60 * 60 * 1000;
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'SuperSpeechListener/1.0';
const NOTIFY_EMAIL = process.env.REDDIT_NOTIFY_EMAIL || 'hello@superspeech.biz';
const MAX_NEW_PER_CYCLE = 5;            // never email-bomb, even on a busy cycle
const MAX_POST_AGE_MS = 48 * 3600 * 1000; // only alert on posts < 48h old

const QUERIES = [
  '"best man speech"',
  '"maid of honor speech"',
  '"maid of honour speech"',
  '"father of the bride speech"',
  '"mother of the bride speech"',
  '"groom speech"',
  '"wedding speech" help',
  '"wedding toast"',
  '"eulogy" write',
  '"help me write" speech',
  '"retirement speech"',
  '"graduation speech"'
];

const REQUEST_DELAY_MS = 2500; // stay well under Reddit's public rate limits

let timer = null;
let polling = false;
let oauthToken = null;
let oauthExpiresAt = 0;

// Optional: script-app creds give oauth.reddit.com access + better limits.
// New-style apps authenticate as the linked account (password grant); older
// script apps can also mint app-only tokens via client_credentials. Without
// any creds the public JSON endpoints are tried (datacenter IPs often 403).
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
  const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const headers = { 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await axios.get(`${base}/search.json`, {
    params: { q: query, sort: 'new', limit: 25 },
    headers,
    timeout: 15000
  });
  return (res.data?.data?.children || []).map(c => c.data);
}

function isAlertable(post) {
  if (!post || !post.id || post.over_18 || post.removed_by_category) return false;
  if (!post.author || post.author === '[deleted]') return false;
  const ageMs = Date.now() - post.created_utc * 1000;
  return ageMs < MAX_POST_AGE_MS;
}

async function processPost(post) {
  const ref = db.collection('redditLeads').doc(post.id);
  const existing = await ref.get();
  if (existing.exists) return false;

  const draftReply = await aiService.generateRedditReply(post.title, post.selftext, post.subreddit);

  const lead = {
    postId: post.id,
    subreddit: post.subreddit,
    title: post.title,
    body: (post.selftext || '').slice(0, 3000),
    permalink: post.permalink,
    author: post.author,
    postCreatedUtc: post.created_utc,
    draftReply: draftReply || '(AI draft unavailable - read the post and reply manually)',
    status: 'new',
    createdAt: new Date().toISOString()
  };

  await ref.set(lead);
  await emailService.sendRedditLeadAlert(NOTIFY_EMAIL, lead);
  console.log(`✓ Reddit lead saved + emailed: r/${lead.subreddit} - ${lead.title.slice(0, 60)}`);
  return true;
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  let newCount = 0;

  try {
    for (const query of QUERIES) {
      if (newCount >= MAX_NEW_PER_CYCLE) break;
      let posts;
      try {
        posts = await searchReddit(query);
      } catch (e) {
        console.warn(`Reddit search failed for ${query}: ${e.message}`);
        continue;
      }

      for (const post of posts) {
        if (newCount >= MAX_NEW_PER_CYCLE) break;
        if (!isAlertable(post)) continue;
        try {
          if (await processPost(post)) newCount++;
        } catch (e) {
          console.warn(`Reddit lead processing failed (${post.id}): ${e.message}`);
        }
      }

      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
    if (newCount) console.log(`Reddit sweep: ${newCount} new lead(s)`);
  } catch (error) {
    console.error('Reddit listener sweep failed:', error.message);
  } finally {
    polling = false;
  }
}

function start() {
  if (timer) return;
  console.log(`Reddit listener started - polling every ${POLL_INTERVAL_MS / 60000} min, alerts to ${NOTIFY_EMAIL}`);
  // First sweep after a short delay so the server finishes booting
  setTimeout(() => pollOnce(), 60 * 1000);
  timer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

module.exports = { start, pollOnce };
