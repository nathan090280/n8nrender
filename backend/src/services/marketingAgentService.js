const dns = require('dns').promises;
const { db } = require('../config/firebase');
const aiService = require('./aiService');
const emailService = require('./emailService');
const { londonNow } = require('../utils/londonTime');

// The Marketing Executive: invents ONE fresh marketing play per day at
// MARKETING_HOUR:MARKETING_MINUTE UK and executes it alone - routine work
// (tips, newsletter, social, follow-ups) is scheduled elsewhere. Plays may
// include ONE targeted cold email/day (MX-validated, never repeated, BCC'd
// to Nathan); anything needing a human-only step gets flagged in the
// daily report email to hello@.
//
// Every action logs to Firestore marketingActions, surfaces in the nightly
// digest, and gets its own report email.

const AGENT_EMAIL = process.env.MARKETING_AGENT_EMAIL || 'hello@superspeech.biz';
const FOLLOWUP_MIN_DAYS = 3;
const FOLLOWUP_MAX_DAYS = 6;
const FOLLOWUP_MAX_PER_DAY = 3;

const AGENT_CONTEXT = `You are the autonomous Marketing Executive for SuperSpeech (superspeech.biz), an AI-powered custom speechwriting service run by one person (Nathan).

BUSINESS FACTS:
- Customers order via the questionnaire (occasion, tone, package): The Toast £9.99 (~2 min), The Main Event £19.99 (~5 min), The Keynote £34.99 (~10 min) - all include free edits.
- ALREADY AUTOMATED - never spend today's play on these: SEO tip cards (published Tue+Fri), the newsletter (Sundays 19:00), social card posts (daily 18:00), customer follow-up emails, the Reddit lead listener.
- Voice: warm, witty, professional. British English.

YOUR JOB: invent ONE fresh marketing play every day and execute it yourself. Nathan wants INGENUITY - new strategies, new angles, new channels - not routine work, and not repeats of plays you've already run (check the history). He approves nothing in advance; he reads the report afterwards. If a play needs a human-only step (a login, a web form, a phone call), still run the parts you can and flag what you need.

HARD LIMIT: you can NEVER change the website, its structure, the backend, pricing, packages, or any code/config. Your tools are exactly: send ONE email, and describe plans for Nathan. Don't propose site changes - work entirely in channels outside the site (email, directories, partners, press, communities).

WHAT A PLAY CAN BE - be creative, these are examples not a menu:
- ONE strategically-targeted cold email (a directory listing, a vendor cross-promo, a guest-post pitch, a press/journalist angle, a podcast ask)
- A new offer or scheme: referral incentive, seasonal bundle, giveaway mechanic, discount-code campaign for a specific community
- A press release or media pitch to wedding/event journalists
- A partnership proposal between SuperSpeech and an adjacent business
- Signing us up for something via email-based channels
- Anything else you can execute via one email, or describe concretely enough that Nathan can finish it in two minutes

COLD EMAIL RULES (only when the play involves emailing someone):
- ONE external email max per day - only fill the email fields if today's play truly needs one
- Strategic targets only - plausible path to a lead, a sale, or distribution. Never a random address
- Real, established domains with published-style addresses (hello@, info@, press@, submissions@). If the domain can't accept mail the send aborts and Nathan gets the draft instead
- Never email the same address twice; no fake familiarity; ONE clear ask; signed "Nathan, superspeech.biz"`;

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
  return acts.some(a => a.targetEmail === email);
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

// The daily play: whatever strategy the agent invented. If it includes an
// email, that ONE email goes through the safety rails (real shape, not us,
// never-contacted, domain accepts mail) then sends - BCC'd to Nathan.
// If the email can't be sent, the draft goes to Nathan marked "not sent"
// (reply "Approved" to send it). Non-email plays just get reported.
async function execDailyPlay(payload) {
  const out = {
    playName: payload.playName,
    summary: payload.summary,
    strategy: payload.strategy,
    needsNathan: !!payload.needsNathan,
    nathanNote: payload.nathanNote
  };

  const wantsEmail = payload.targetEmail || payload.subject || payload.body;
  if (!wantsEmail) return out;

  const to = String(payload.targetEmail || '').trim().toLowerCase();
  const complete = payload.subject && payload.body;
  const validShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  const isSelf = to === (process.env.EMAIL_FROM || 'hello@superspeech.biz').toLowerCase();

  if (complete && validShape && !isSelf
      && !(await alreadyEmailedCold(to)) && await domainAcceptsMail(to)) {
    await emailService.transporter.sendMail({
      from: `Nathan @ SuperSpeech <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
      to,
      subject: payload.subject,
      text: String(payload.body),
      html: SENT_EMAIL_HTML(payload.body),
      bcc: AGENT_EMAIL // owner sees every send - he asked to be surprised
    });
    await recordLead({
      email: to, name: payload.targetName,
      subject: payload.subject, body: payload.body,
      source: 'agent-daily-play', strategy: payload.strategy
    });
    out.emailSent = { to, subject: payload.subject };
    return out;
  }

  // Couldn't send - keep the draft email so Nathan can "Approved"-reply it
  const why = !complete ? 'email fields incomplete'
    : !validShape ? 'no valid address supplied'
    : isSelf ? 'target was our own address'
    : await alreadyEmailedCold(to) ? 'already contacted'
    : 'domain does not accept mail (no MX records)';
  out.emailNotSent = why;
  if (complete) {
    await emailService.transporter.sendMail({
      from: `SuperSpeech Marketing Agent <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
      to: AGENT_EMAIL,
      subject: `[Marketing Agent] Outreach draft (not sent): ${payload.targetName || 'new target'}`,
      html: [
        `<p><b>Agent note:</b> draft NOT sent automatically (${why}). Reply "Approved" to send it.</p>`,
        `<p><b>Target:</b> ${payload.targetName || ''} &lt;${to}&gt;</p><hr>`,
        `<p><b>Subject:</b> ${payload.subject}</p>`,
        SENT_EMAIL_HTML(payload.body)
      ].join('')
    });
    out.draftTo = to; out.draftSubject = payload.subject; out.draftBody = payload.body;
    out.draftedFor = payload.targetName;
  }
  return out;
}

// When the agent needs something only Nathan can do (a login, a manual
// signup, a decision), it asks rather than stalling.
async function execAskNathan(payload) {
  return { askedFor: payload.playName, note: payload.nathanNote };
}

const EXECUTORS = {
  daily_play: execDailyPlay,
  ask_nathan: execAskNathan
};

// Nathan wants a daily surprise report - this is it. Sent after every run
// (including rests) so he always knows what his exec did today.
async function sendDailyReport({ decision, result, followups, error }) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const p = t => `<p style="margin:0 0 14px;line-height:1.6;">${t}</p>`;
  const blocks = [];

  if (error) {
    blocks.push(p(`<b>Today's play hit a snag:</b> ${esc(error)}`));
  } else if (decision.action === 'rest') {
    blocks.push(p(`<b>Today's play:</b> rested - <i>${esc(decision.reason || 'nothing worth doing')}</i>`));
  } else {
    blocks.push(p(`<b>Today's play:</b> ${esc(decision.playName || decision.action)}`));
    if (decision.strategy) blocks.push(p(`<b>Strategy:</b> ${esc(decision.strategy)}`));
    blocks.push(p(`<b>Why:</b> ${esc(decision.reason)}`));
    if (decision.summary) blocks.push(p(`<b>The plan:</b> ${esc(decision.summary)}`));
    if (result?.emailSent) {
      blocks.push(p(`✅ <b>Email sent to</b> ${esc(result.emailSent.to)} - subject: "${esc(result.emailSent.subject)}" (BCC'd to you)`));
      if (decision.body) blocks.push(`<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:8px;margin:14px 0;">${SENT_EMAIL_HTML(esc(decision.body))}</div>`);
    }
    if (result?.emailNotSent) blocks.push(p(`📋 Email couldn't send (${esc(result.emailNotSent)}) - draft emailed separately, reply "Approved" to send it.`));
    if (result?.askedFor) blocks.push(p(`🙋 <b>Needs you:</b> ${esc(result.askedFor)}<br>${esc(result.note)}`));
    if (result?.needsNathan && result?.nathanNote) blocks.push(p(`🙋 <b>Needs you:</b> ${esc(result.nathanNote)}`));
  }
  if (followups?.length) blocks.push(p(`📬 Follow-up emails also went to ${followups.length} customer(s).`));

  await emailService.transporter.sendMail({
    from: `SuperSpeech Marketing Agent <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: AGENT_EMAIL,
    subject: `[Marketing Agent] Today's play: ${decision?.playName || decision?.action || 'none'}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1e293b;">${blocks.join('')}</div>`
  });
}

// --- the daily decision -----------------------------------------------------

function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function decide(context) {
  const prompt = `${context}

Reply with ONLY a JSON object - flat shape, all fields at the TOP LEVEL:
{
  "action": "daily_play" | "ask_nathan" | "rest",
  "playName": "short catchy name for today's play",
  "reason": "one sentence why this is today's best move",
  "summary": "2-3 sentences: what the play is, how it works, expected outcome",
  "needsNathan": true or false,
  "nathanNote": "what you need from him if anything (a login, a form, a decision) - omit if nothing"
}
- daily_play: the fields above, PLUS these ONLY if the play involves sending one real email: "targetName" (org/person), "targetEmail" (a REAL address - it gets emailed directly), "strategy" (e.g. "press pitch", "directory listing", "cross-promo offer", "guest post pitch"), "subject", "body" (short, warm, non-spammy, signed "Nathan, superspeech.biz", ONE clear ask)
- ask_nathan: "playName" = what you're trying to do, "nathanNote" = exactly what you need from him
- rest: only if genuinely nothing is worth doing today

Surprise Nathan - invent strategies he hasn't thought of. Repeating yesterday's play is failure.`;

  const raw = await aiService.generateSocialCopy(prompt, { maxTokens: 1600, temperature: 0.8 });
  const parsed = extractJson(raw);
  if (!parsed) console.warn('[Marketing] decision parse failed, raw:', String(raw).slice(0, 500));
  return parsed;
}

// Does a decision carry the fields its executor needs?
function payloadMissing(d) {
  const need = {
    daily_play: ['playName', 'reason', 'summary'],
    ask_nathan: ['playName', 'nathanNote'],
    rest: []
  }[d.action] || ['__unknown_action__'];
  return need.filter(k => !d[k]);
}

async function buildContext() {
  const [acts, subs, leadsSnap, redditSnap] = await Promise.all([
    recentActions(15), subscriberCount(),
    db.collection('marketingLeads').get().catch(() => null),
    db.collection('redditLeads').orderBy('createdAt', 'desc').limit(20).get().catch(() => null)
  ]);
  const leads = leadsSnap ? leadsSnap.size : 0;
  const leadsReplied = leadsSnap ? leadsSnap.docs.filter(d => d.data().status === 'replied').length : 0;
  const recentLeads = redditSnap ? redditSnap.size : 0;
  const history = acts.length
    ? acts.map(a => `- ${a.date} [${a.type}] ${a.title || a.summary || ''}`).join('\n')
    : 'No marketing actions recorded yet - this is day one.';
  return `HISTORY (most recent first - do NOT repeat these plays):
${history}

CURRENT STATE:
- Mailing-list subscribers: ${subs}
- Outreach leads contacted: ${leads} (${leadsReplied} replied)
- Reddit leads found recently: ${recentLeads}
- Customers eligible for follow-up (handled automatically, never today's play): handled separately`;
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
    // AI failed, picked rest, or skipped required fields - log + report
    const why = !decision ? 'decision parse failed'
      : !EXECUTORS[decision.action] && decision.action !== 'rest' ? `unknown action "${decision.action}"`
      : decision.action === 'rest' ? `rested: ${decision.reason || ''}`
      : `missing fields: ${missing.join(', ')}`;
    await logAction({ type: 'rest', title: why, summary: decision?.reason || 'Claude returned no usable decision' });
    await sendDailyReport({ decision: decision || { action: 'rest', reason: why }, followups }).catch(e => console.warn('[Marketing] report failed:', e.message));
    return { action: 'rest', reason: decision?.reason || why, followups };
  }

  let result;
  try {
    result = await EXECUTORS[decision.action](decision);
  } catch (e) {
    console.error('[Marketing] executor failed:', decision.action, e.message);
    await logAction({ type: decision.action, title: decision.playName || 'Action failed', summary: e.message, emailSent: false });
    await sendDailyReport({ decision, error: e.message, followups }).catch(() => {});
    return { action: decision.action, error: e.message, followups };
  }

  await logAction({
    type: decision.action,
    title: decision.playName || decision.action,
    summary: decision.reason,
    detail: { ...result, summary: decision.summary, strategy: decision.strategy },
    targetEmail: result.emailSent?.to,
    emailSent: !!result.emailSent
  });
  await sendDailyReport({ decision, result, followups }).catch(e => console.warn('[Marketing] report failed:', e.message));
  console.log(`[Marketing] daily play: ${decision.playName || decision.action} - ${decision.reason}`);
  return { action: decision.action, reason: decision.reason, result, followups };
}

module.exports = { runDaily, runFollowupSweep, recordLead };
