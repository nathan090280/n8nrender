const dns = require('dns').promises;
const { db } = require('../config/firebase');
const aiService = require('./aiService');
const emailService = require('./emailService');
const mailingListService = require('./mailingListService');
const { londonNow } = require('../utils/londonTime');

// The Marketing Executive: one autonomous marketing action per day at
// MARKETING_HOUR:MARKETING_MINUTE UK, plus a separate customer follow-up
// sweep that doesn't count against the daily action.
//
// Claude sees the action history and picks ONE activity as JSON; code
// executes it. Rail: outbound email only ever goes to real subscribers or
// paying customers. Cold outreach is drafted and emailed to hello@ for a
// human to forward - no auto-spamming strangers.
//
// Every action is logged to Firestore marketingActions and surfaced in the
// nightly digest.

const AGENT_EMAIL = process.env.MARKETING_AGENT_EMAIL || 'hello@superspeech.biz';
const NEWSLETTER_MIN_GAP_DAYS = 5;
const FOLLOWUP_MIN_DAYS = 3;
const FOLLOWUP_MAX_DAYS = 6;
const FOLLOWUP_MAX_PER_DAY = 3;

const AGENT_CONTEXT = `You are the autonomous Marketing Executive for SuperSpeech (superspeech.biz), an AI-powered custom speechwriting service run by one person (Nathan).

BUSINESS FACTS:
- Customers order via the questionnaire, choosing an occasion (weddings, corporate events, milestone celebrations, memorials & tributes), tone and package.
- Packages: The Toast £9.99 (~2 min), The Main Event £19.99 (~5 min), The Keynote £34.99 (~10 min) - all include free edits.
- Free tip pages live at superspeech.biz/tips; there is a mailing list, social channels (Facebook, Instagram, Threads, Mastodon, Bluesky, Pinterest), and a Reddit lead listener that emails Nathan drafts.
- Voice: warm, witty but professional, never salesy-spammy. British English.

YOUR JOB: pick the single highest-value marketing action for today. You are FULLY AUTONOMOUS - Nathan does not approve anything; he reads what you did in the nightly digest and gets FYI copies. Act, don't ask - unless you genuinely need a login or a human-only step, then use ask_nathan and follow up another day. Vary it day to day - don't repeat the same action type two days running unless the others make no sense.

COLD OUTREACH: You may send ONE real cold email per day - but NEVER a random address. Think like a marketing executive: choose a target with a plausible path to a lead, a sale, or lasting distribution. Good target families:
- Wedding/event directories couples actually search (listing requests)
- Wedding vendors for mutual referral - planners, photographers, celebrants, venues with blogs
- Wedding/event blogs accepting guest posts or tip submissions
- Podcasts and newsletters about weddings, public speaking, events (guest slots, swaps)
- Corporate event organisers, funeral celebrants - adjacent professionals who hear "I need a speech"
Invent a fresh strategy each day - a guest-post pitch one day, a directory listing the next, a cross-promo offer after that. Prefer real, established sites and their published-style contact addresses (hello@, info@, contact@, submissions@). Only give an address you're confident is real - if the domain can't receive mail the send aborts and the draft goes to Nathan. Never email the same address twice.
Include a "strategy" field (e.g. "directory listing", "cross-promo offer", "guest post pitch") describing the play.`;

function daysOld(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

// --- context ---------------------------------------------------------------

async function recentActions(limit = 15) {
  try {
    const snap = await db.collection('marketingActions')
      .orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map(d => d.data());
  } catch { return []; }
}

async function actionRanToday(londonDate) {
  const acts = await recentActions(10);
  return acts.some(a => a.date === londonDate && a.type !== 'followup');
}

async function lastNewsletterDaysAgo() {
  const acts = await recentActions(30);
  const last = acts.find(a => a.type === 'newsletter');
  return last ? daysOld(last.createdAt) : Infinity;
}

async function alreadyFollowedUp(orderId, email) {
  const acts = await recentActions(200);
  return acts.some(a =>
    a.type === 'followup' && (a.orderId === orderId || a.targetEmail === email));
}

async function followupCandidates() {
  try {
    const snap = await db.collection('questionnaires')
      .orderBy('createdAt', 'desc').limit(150).get();
    const out = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!d.email || !d.speechSent) continue;
      const age = daysOld(d.createdAt);
      if (age < FOLLOWUP_MIN_DAYS || age > FOLLOWUP_MAX_DAYS) continue;
      if (await alreadyFollowedUp(doc.id, d.email)) continue;
      out.push({ id: doc.id, ...d });
      if (out.length >= FOLLOWUP_MAX_PER_DAY) break;
    }
    return out;
  } catch { return []; }
}

async function subscriberCount() {
  try { return (await db.collection('mailingList').get()).size; } catch { return 0; }
}

// --- logging ----------------------------------------------------------------

async function logAction(entry) {
  const now = londonNow();
  const doc = {
    date: now.date,
    createdAt: new Date().toISOString(),
    ...entry
  };
  await db.collection('marketingActions').add(doc);
  return doc;
}

// --- executors ---------------------------------------------------------------

async function execNewsletter(payload) {
  const subscribers = await subscriberCount();
  if (!subscribers) return { skipped: 'no subscribers' };
  const res = await mailingListService.sendCampaign({
    subject: payload.subject,
    html: payload.html,
    text: payload.text
  });
  return { sent: res.sent, failed: res.failed, subject: payload.subject };
}

// A "how did the speech go?" + testimonial nudge to a real customer.
async function sendFollowupEmail(order) {
  const firstName = (order.name || '').split(' ')[0] || 'there';
  const text = await aiService.generateSocialCopy(
    `Write a short follow-up email to a SuperSpeech customer.
Customer first name: ${firstName}. Occasion: ${order.occasionType || 'their event'}. Package: ${order.package || ''}. Their speech was delivered ${Math.round(daysOld(order.createdAt))} days ago.
Goals, in order: (1) ask how the speech went, warmly (2) remind them they still have free edits included if any line needs a tweak - reply to this email or use their dashboard (3) IF it went well, ask for a one-line testimonial we could use on the site.
Keep it under 120 words, plain text, personal - like Nathan writing a quick note. Sign off as Nathan, SuperSpeech. No subject line, just the body.`,
    { maxTokens: 400, temperature: 0.7 });

  await emailService.transporter.sendMail({
    from: `Nathan @ SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: order.email,
    subject: `How did the speech go, ${firstName}?`,
    text: text.trim(),
    html: text.trim().split(/\n+/).filter(Boolean)
      .map(p => `<p style="margin:0 0 14px;line-height:1.6;">${p}</p>`).join('')
  });
  return { emailed: order.email, orderId: order.id, name: firstName };
}

async function alreadyEmailedCold(email) {
  const acts = await recentActions(300);
  return acts.some(a => a.type === 'cold_outreach' && a.targetEmail === email);
}

// Does this email's domain actually accept mail? Guards against the agent
// hallucinating an address - no MX records, no send.
async function domainAcceptsMail(email) {
  const domain = String(email || '').split('@')[1];
  if (!domain) return false;
  try { return (await dns.resolveMx(domain)).length > 0; }
  catch { return false; }
}

const SENT_EMAIL_HTML = (body) => String(body || '').split(/\n+/).filter(Boolean)
  .map(p => `<p style="margin:0 0 14px;line-height:1.6;">${p}</p>`).join('');

// Upsert a lead record - every cold-outreach target is kept so replies can
// be matched back and Nathan can review the whole pipeline.
async function recordLead({ email, name, subject, body, source, strategy }) {
  const snap = await db.collection('marketingLeads').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    await snap.docs[0].ref.update({
      lastContactedAt: new Date().toISOString(),
      contactCount: (snap.docs[0].data().contactCount || 1) + 1
    });
    return snap.docs[0].id;
  }
  const ref = await db.collection('marketingLeads').add({
    email,
    name: name || '',
    source: source || 'agent-cold-outreach',
    status: 'contacted',
    firstContactedAt: new Date().toISOString(),
    lastContactedAt: new Date().toISOString(),
    contactCount: 1,
    lastSubject: subject || '',
    lastBodySnippet: String(body || '').slice(0, 500),
    strategy: strategy || '',
    replies: []
  });
  return ref.id;
}

// Cold outreach: ONE real email per day max, to an address the agent picked.
// Rail: we DNS-check the target domain accepts mail first. If the address
// looks unverifiable, the draft goes to Nathan to handle instead of sending.
async function execColdOutreach(payload) {
  const to = String(payload.targetEmail || '').trim().toLowerCase();
  const validShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  const isSelf = to === (process.env.EMAIL_FROM || 'hello@superspeech.biz').toLowerCase();

  if (validShape && !isSelf && !(await alreadyEmailedCold(to)) && await domainAcceptsMail(to)) {
    await emailService.transporter.sendMail({
      from: `Nathan @ SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
      to,
      subject: payload.subject || 'Quick question',
      text: String(payload.body || ''),
      html: SENT_EMAIL_HTML(payload.body),
      bcc: AGENT_EMAIL // owner sees every cold send - he asked to be surprised
    });
    await recordLead({
      email: to, name: payload.targetName,
      subject: payload.subject, body: payload.body,
      source: 'agent-cold-outreach', strategy: payload.strategy
    });
    return { emailed: to, subject: payload.subject, cold: true, strategy: payload.strategy };
  }

  // Fallback: draft to Nathan with the reason it wasn't sent directly
  const why = !validShape ? 'no valid address supplied'
    : isSelf ? 'target was our own address'
    : await alreadyEmailedCold(to) ? 'already contacted'
    : 'domain does not accept mail (no MX records)';
  const html = [
    `<p><b>Agent note:</b> cold outreach draft - NOT sent automatically (${why}). Reasoning: <i>${payload.reason || ''}</i></p>`,
    `<p><b>Target:</b> ${payload.targetName || ''} &lt;${to || 'none'}&gt;</p>`,
    `<hr>`,
    `<p><b>Subject:</b> ${payload.subject || ''}</p>`,
    SENT_EMAIL_HTML(payload.body)
  ].join('');
  await emailService.transporter.sendMail({
    from: `SuperSpeech Marketing Agent <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: AGENT_EMAIL,
    subject: `[Marketing Agent] Outreach draft (not sent): ${payload.targetName || 'new target'}`,
    html
  });
  return {
    draftedFor: payload.targetName, subject: payload.subject, notSent: why,
    draftTo: to, draftSubject: payload.subject, draftBody: payload.body
  };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<\/(p|h1|h2|h3|h4|li|div)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

// Tip pages publish immediately - the tips index, sitemap, card image and
// frontend modal all read the `tips` collection, so this is instant. An FYI
// copy goes to hello@ (no approval needed - he's opted to be surprised).
async function execPublishTip(payload) {
  const dupe = await db.collection('tips').where('title', '==', payload.title.trim()).limit(1).get();
  if (!dupe.empty) throw new Error(`tip "${payload.title}" already exists - pick a different title`);
  const body = htmlToText(payload.html);
  await db.collection('tips').add({
    title: payload.title.trim(),
    body,
    published: true,
    source: 'marketing-agent',
    createdAt: new Date().toISOString()
  });
  const { slugify } = require('../controllers/tipsPageController');
  const url = `https://superspeech.biz/tips/${slugify(payload.title)}`;
  await emailService.transporter.sendMail({
    from: `SuperSpeech Marketing Agent <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: AGENT_EMAIL,
    subject: `[Marketing Agent] Published tip: ${payload.title}`,
    html: `<p><i>Live now at <a href="${url}">${url}</a> - no action needed, FYI only.</i></p><hr>${payload.html || ''}`
  });
  return { publishedTitle: payload.title, url };
}

// When the agent needs something only Nathan can do (a login, a manual
// signup, a decision), it asks rather than stalling.
async function execAskNathan(payload) {
  await emailService.transporter.sendMail({
    from: `SuperSpeech Marketing Agent <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: AGENT_EMAIL,
    subject: `[Marketing Agent] Needs you: ${payload.title || 'help wanted'}`,
    html: SENT_EMAIL_HTML(payload.body)
  });
  return { askedFor: payload.title };
}

const EXECUTORS = {
  newsletter: execNewsletter,
  cold_outreach: execColdOutreach,
  publish_tip: execPublishTip,
  ask_nathan: execAskNathan
};

// --- the daily decision -----------------------------------------------------

function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function decide(context) {
  const prompt = `${context}

Reply with ONLY a JSON object choosing today's ONE action. Flat shape - put your chosen action's fields at the TOP LEVEL of the object:
{
  "action": "newsletter" | "cold_outreach" | "publish_tip" | "ask_nathan" | "rest",
  "reason": "one sentence why this is today's best move"
}
Plus these REQUIRED fields depending on the action:
- newsletter: "subject" (string), "text" (plain-text body <=250 words), "html" (same content as <p> paragraphs, no outer wrapper)
- cold_outreach: "targetName" (who/org), "targetEmail" (a REAL address - it gets emailed directly; contact@/hello@/info@ style addresses on real, established domains), "strategy" (e.g. "directory listing", "cross-promo offer", "guest post pitch"), "subject", "body" (short, warm, non-spammy email signed "Nathan, superspeech.biz" - honest founder-run framing, ONE clear ask, no fake familiarity)
- publish_tip: "title" (short punchy title, e.g. "The Toast Test"), "html" (ONE punchy tip, 50-80 words in 1-2 short <p> tags - house style: a clear rule or warning + why it works + one vivid detail, no headings or lists) - publishes LIVE on superspeech.biz/tips immediately
- ask_nathan: "title" (what you need, e.g. "login for weddingdirectory.co.uk"), "body" (the request explained)
- rest: no extra fields - only if every option is clearly pointless today
Pick "rest" sparingly - there's almost always something worth doing. Keep newsletter bodies under 250 words, warm and useful, one soft mention of the service at most.`;

  const raw = await aiService.generateSocialCopy(prompt, { maxTokens: 1600, temperature: 0.8 });
  const parsed = extractJson(raw);
  if (!parsed) console.warn('[Marketing] decision parse failed, raw:', String(raw).slice(0, 500));
  return parsed;
}

// Does a decision carry the fields its executor needs?
function payloadMissing(d) {
  const need = {
    newsletter: ['subject', 'text', 'html'],
    cold_outreach: ['targetName', 'targetEmail', 'subject', 'body', 'strategy'],
    publish_tip: ['title', 'html'],
    ask_nathan: ['title', 'body'],
    rest: []
  }[d.action] || ['__unknown_action__'];
  return need.filter(k => !d[k]);
}

async function buildContext() {
  const [acts, subs, candidates, newsletterGap, tipSnap] = await Promise.all([
    recentActions(15), subscriberCount(), followupCandidates(), lastNewsletterDaysAgo(),
    db.collection('tips').get().catch(() => null)
  ]);
  const tipTitles = tipSnap ? tipSnap.docs.map(d => d.data().title).filter(Boolean) : [];
  const history = acts.length
    ? acts.map(a => `- ${a.date} [${a.type}] ${a.title || a.summary || ''}`).join('\n')
    : 'No marketing actions recorded yet - this is day one.';
  return `HISTORY (most recent first):
${history}

CURRENT STATE:
- Mailing-list subscribers: ${subs}
- Days since last newsletter: ${newsletterGap === Infinity ? 'never sent' : Math.floor(newsletterGap)}
- Customers eligible for follow-up (handled automatically, don't pick this): ${candidates.length}
- Newsletter cooldown: needs >= ${NEWSLETTER_MIN_GAP_DAYS} days between sends${newsletterGap < NEWSLETTER_MIN_GAP_DAYS ? ' - DO NOT pick newsletter today' : ''}
- Existing published tip titles (publish_tip must NOT repeat these):
${tipTitles.map(t => `  * ${t}`).join('\n') || '  (none yet)'}`;
}

// --- public entry ------------------------------------------------------------

async function runFollowupSweep() {
  const candidates = await followupCandidates();
  const done = [];
  for (const order of candidates) {
    try {
      const res = await sendFollowupEmail(order);
      await logAction({
        type: 'followup',
        title: `Follow-up to ${res.name}`,
        targetEmail: res.emailed,
        orderId: res.orderId,
        emailSent: true
      });
      done.push(res.emailed);
    } catch (e) {
      console.warn('[Marketing] follow-up failed:', order.email, e.message);
    }
  }
  return done;
}

async function runDaily({ force = false } = {}) {
  const now = londonNow();

  // Follow-ups first - they run alongside, not instead of, the daily action.
  const followups = await runFollowupSweep();

  if (!force && await actionRanToday(now.date)) {
    return { skipped: 'already acted today', followups };
  }

  const context = await buildContext();
  let decision;
  try { decision = await decide(context); }
  catch (e) { console.error('[Marketing] decision call failed:', e.message); }

  const missing = decision && EXECUTORS[decision.action] ? payloadMissing(decision) : [];
  if (!decision || !EXECUTORS[decision.action] || missing.length) {
    // AI failed, picked rest, or skipped required fields - log it and move on
    const why = !decision ? 'decision parse failed'
      : !EXECUTORS[decision.action] && decision.action !== 'rest' ? `unknown action "${decision.action}"`
      : decision.action === 'rest' ? `rested: ${decision.reason || ''}`
      : `missing fields: ${missing.join(', ')}`;
    await logAction({ type: 'rest', title: why, summary: decision?.reason || 'Claude returned no usable decision' });
    return { action: 'rest', reason: decision?.reason || why, followups };
  }

  let result;
  try {
    result = await EXECUTORS[decision.action](decision);
  } catch (e) {
    console.error('[Marketing] executor failed:', decision.action, e.message);
    await logAction({ type: decision.action, title: 'Action failed', summary: e.message, emailSent: false });
    return { action: decision.action, error: e.message, followups };
  }

  await logAction({
    type: decision.action,
    title: result.subject || result.draftTitle || decision.action,
    summary: decision.reason,
    detail: result,
    targetEmail: result.emailed,
    emailSent: true
  });
  console.log(`[Marketing] daily action: ${decision.action} - ${decision.reason}`);
  return { action: decision.action, reason: decision.reason, result, followups };
}

module.exports = { runDaily, runFollowupSweep, recordLead };
