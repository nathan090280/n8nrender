const dns = require('dns').promises;
const vm = require('vm');
const axios = require('axios');
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

YOUR JOB: invent ONE fresh marketing play every day and execute it COMPLETELY ALONE. Nathan wants INGENUITY - new strategies, new angles, new channels - not routine work, and not repeats of plays you've already run (check the history).

ABSOLUTE RULES - breaking these is failure:
- Nathan does ZERO work. NEVER pick a play that needs him to do anything - no calls, no accounts to create, no forms, no approvals, no "flag what you need". If a great idea needs a human, DON'T PICK IT - pick one you can finish alone.
- Nathan is NOT a product and NEVER goes anywhere personally: no podcast guest pitches, no interviews, no workshops, no speaking offers, nothing that requires him to appear, talk, or be the face of anything. You are selling a SERVICE, not a person.
- Emails you send come from hello@superspeech.biz about the service - never volunteer Nathan personally for anything.
- You can NEVER change the website, its structure, the backend, pricing, packages, or any code/config.
- Your tools are exactly: send ONE email, fetch ONE page for research, run ONE small script, and describe the play. Use them fully - a play you complete is worth ten you can't.

WHAT A PLAY CAN BE - be creative, these are examples not a menu:
- ONE strategically-targeted cold email (a directory listing, a vendor cross-promo, a guest-post pitch, a press/journalist angle, a podcast ask)
- Signing us up to something via email (directory listings, communities, newsletters - we own hello@superspeech.biz, sign-up confirmations land in our inbox)
- RESEARCHING a real page first (researchUrl below) - e.g. fetch a directory's contact page and extract the REAL email instead of guessing
- Running a small script of your own (script field) - pure computation only: parsing text, extracting emails from a fetched page, crunching numbers, formatting output. NO network, NO filesystem, keep it tiny - it's a scalpel not a bulldozer
- A new offer or scheme, a press release, a partnership proposal - anything describable
- Anything else YOU can fully execute via one email, a page fetch, or a small script - if it needs Nathan's hands, it does not count

COLD EMAIL RULES (only when the play involves emailing someone):
- ONE external email max per day - only fill the email fields if today's play truly needs one
- Strategic targets only - plausible path to a lead, a sale, or distribution. Never a random address
- Real, established domains. STRONGLY prefer using researchUrl on the target's contact/about page to find the REAL published address rather than guessing - a failed address wastes the day's one email. Guessing is a last resort; we'll still try to self-heal it by scraping their contact page
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
async function execDailyPlay(payload, pageText) {
  const out = {
    playName: payload.playName,
    summary: payload.summary,
    strategy: payload.strategy,
  };

  // The agent's own script - tiny sandboxed compute. Input defaults to the
  // researched page text if it fetched one.
  if (payload.script) {
    const input = payload.scriptInput !== undefined ? payload.scriptInput : (pageText || null);
    const r = runAgentScript(String(payload.script).slice(0, 4000), input);
    out.scriptResult = r.result !== undefined ? r.result : r.error;
    if (r.log?.length) out.scriptLog = r.log;
  }

  const wantsEmail = payload.targetEmail || payload.subject || payload.body;
  if (!wantsEmail) return out;

  let to = String(payload.targetEmail || '').trim().toLowerCase();
  const complete = payload.subject && payload.body;
  const validShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  const isSelf = to === (process.env.EMAIL_FROM || 'hello@superspeech.biz').toLowerCase();
  const domain = to.split('@')[1] || '';

  // Mandatory research: an address is trusted if it appeared on a fetched
  // page, or if we scrape one off the domain's contact pages right now.
  // A real scraped address always beats a guessed one.
  if (complete && validShape && !isSelf) {
    const fromResearch = !!(pageText && pageText.toLowerCase().includes(to));
    if (!fromResearch) {
      const found = await findRealAddress(domain);
      if (found && found !== to && !(await alreadyEmailedCold(found))) {
        out.healedAddress = { guessed: to, found };
        to = found;
      }
    }
  }

  // Send only if: address found on their site OR their domain accepts mail.
  if (complete && validShape && !isSelf
      && !(await alreadyEmailedCold(to))
      && (out.healedAddress || (pageText && pageText.toLowerCase().includes(to)) || await domainAcceptsMail(to))) {
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
        `<p><b>Agent note:</b> couldn't find a working address - NOT sent (${why}). FYI only, no action needed.</p>`,
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

const EXECUTORS = {
  daily_play: execDailyPlay
};

// --- agent tools: page research + sandboxed script ---------------------------

// Fetch a real page so the agent can RESEARCH instead of guessing (e.g. pull
// the actual contact email off a directory's contact page). Bounded: http(s)
// only, no private hosts, 15s, ~8k chars of stripped text.
async function fetchResearchPage(url) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|\[::1\])/.test(u.hostname)) return null;
    const res = await axios.get(u.toString(), {
      timeout: 15000,
      maxContentLength: 512 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SuperSpeechBot/1.0)' },
      maxRedirects: 3
    });
    const text = String(res.data || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
    return text || null;
  } catch (e) {
    console.warn('[Marketing] research fetch failed:', String(url).slice(0, 100), e.message);
    return null;
  }
}

// The agent's own little scripts: pure computation in a vm sandbox. No
// network, no fs, no require - input in, result out, 3s fuse. For things
// like extracting emails from a fetched page or crunching text.
function runAgentScript(code, input) {
  try {
    const sandbox = { input, result: null, log: [] };
    sandbox.console = { log: (...a) => sandbox.log.push(a.map(String).join(' ')) };
    vm.createContext(sandbox);
    vm.runInContext(
      `result = (function(input){ ${code} })(input)`,
      sandbox, { timeout: 3000 });
    return { result: sandbox.result, log: sandbox.log.slice(0, 20) };
  } catch (e) {
    return { error: e.message };
  }
}

// Pull a real contact address off a domain's usual contact pages. Used to
// self-heal guessed addresses that fail the MX check - autonomy over asking.
async function findRealAddress(domain) {
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const own = (process.env.EMAIL_FROM || 'hello@superspeech.biz').toLowerCase();
  for (const path of ['/contact', '/contact-us', '/about', '']) {
    const text = await fetchResearchPage(`https://${domain}${path}`);
    if (!text) continue;
    for (const found of (text.match(emailRe) || [])) {
      const e = found.toLowerCase();
      if (e === own) continue;
      if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(e)) continue; // regex misfires on filenames
      if (await domainAcceptsMail(e)) return e;
    }
  }
  return null;
}

// Second pass: after fetching a research page, let the agent refine its play
// with REAL data (e.g. swap a guessed address for the one actually on the page).
async function refineWithResearch(context, draft, pageText) {
  const raw = await aiService.generateSocialCopy(
    `${context}

You drafted this play:
${JSON.stringify(draft, null, 1)}

Here is the actual text of the page you asked to research:
---
${pageText}
---

Return the FINAL play as a JSON object - same fields as before. Use REAL facts from the page (a real email address beats a guessed one; if the page shows no usable contact, change the plan or drop the email). If the page was useless, say so in "summary" and adjust.`,
    { maxTokens: 1600, temperature: 0.7 });
  return extractJson(raw);
}

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
    if (decision.researchUrl) blocks.push(p(`🔍 <b>Researched:</b> ${esc(decision.researchUrl)}`));
    if (result?.scriptResult !== undefined) blocks.push(`<div style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px 16px;border-radius:8px;margin:14px 0;font-family:monospace;font-size:12px;white-space:pre-wrap;">${esc(JSON.stringify(result.scriptResult, null, 1)).slice(0, 1500)}</div>`);
    if (result?.emailSent) {
      blocks.push(p(`✅ <b>Email sent to</b> ${esc(result.emailSent.to)} - subject: "${esc(result.emailSent.subject)}" (BCC'd to you)`));
      if (decision.body) blocks.push(`<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:8px;margin:14px 0;">${SENT_EMAIL_HTML(esc(decision.body))}</div>`);
    }
    if (result?.healedAddress) blocks.push(p(`🔧 <b>Self-healed:</b> guessed <s>${esc(result.healedAddress.guessed)}</s>, found real address ${esc(result.healedAddress.found)} on their contact page`));
    if (result?.emailNotSent) blocks.push(p(`📋 Email couldn't send (${esc(result.emailNotSent)}) - draft kept in the log, no action needed.`));

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
  "action": "daily_play" | "rest",
  "playName": "short catchy name for today's play",
  "reason": "one sentence why this is today's best move",
  "summary": "2-3 sentences: what the play is, how it works, expected outcome"
}
- daily_play: the fields above, PLUS any of these optional tools:
  * "researchUrl" - a real page to fetch BEFORE finalising (contact pages, directory listings, anything you want facts from). You'll get the page text and one chance to refine your play with it
  * "script" - a small JS function body, gets {input} (include "scriptInput" if needed, e.g. the fetched page text), returns its result via a return statement. Pure compute only
  * IF the play involves sending one real email: "targetName" (org/person), "targetEmail" (a REAL address - it gets emailed directly), "strategy" (e.g. "press pitch", "directory listing", "cross-promo offer", "guest post pitch"), "subject", "body" (short, warm, non-spammy, signed "Nathan, superspeech.biz", ONE clear ask)
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
    rest: []
  }[d.action] || ['__unknown_action__'];
  return need.filter(k => !d[k]);
}

async function buildContext() {
  const [acts, subs, leadsSnap, redditSnap, ideasSnap] = await Promise.all([
    recentActions(15), subscriberCount(),
    db.collection('marketingLeads').get().catch(() => null),
    db.collection('redditLeads').orderBy('createdAt', 'desc').limit(20).get().catch(() => null),
    db.collection('marketingIdeas').orderBy('createdAt', 'desc').limit(10).get().catch(() => null)
  ]);
  const leads = leadsSnap ? leadsSnap.size : 0;
  const leadsReplied = leadsSnap ? leadsSnap.docs.filter(d => d.data().status === 'replied').length : 0;
  const recentLeads = redditSnap ? redditSnap.size : 0;
  const leadList = redditSnap ? redditSnap.docs.slice(0, 6).map(d => {
    const l = d.data();
    return `  * r/${l.subreddit}: "${String(l.title || '').slice(0, 90)}" by u/${l.author} - ${l.url}`;
  }).join('\n') : '';
  const history = acts.length
    ? acts.map(a => `- ${a.date} [${a.type}] ${a.title || a.summary || ''}`).join('\n')
    : 'No marketing actions recorded yet - this is day one.';
  return `HISTORY (most recent first - do NOT repeat these plays):
${history}

CURRENT STATE:
- Mailing-list subscribers: ${subs}
- Outreach leads contacted: ${leads} (${leadsReplied} replied)
- Reddit leads found recently: ${recentLeads}
${leadList}
- Customers eligible for follow-up (handled automatically, never today's play): handled separately

IDEAS ALREADY GIVEN TO NATHAN (never repeat these):
${ideasSnap ? ideasSnap.docs.map(d => `  * ${d.data().title}`).join('\n') || '  (none yet)' : '  (none yet)'}`;
}

// --- daily idea for Nathan ---------------------------------------------------
// Separate from the autonomous play: one concrete "you do this" idea per day,
// collected in marketingIdeas and surfaced on the nightly digest.
async function generateIdeaForNathan(context) {
  const raw = await aiService.generateSocialCopy(
    `${context}

Separately from your autonomous play, invent ONE marketing idea FOR NATHAN to do himself - a quick practical task only (create an account, fill a form, post something, reply somewhere). HARD RULES: never suggest Nathan appear, speak, be interviewed, be a guest, or act as the expert face of anything - no podcasts, videos, workshops, calls. Admin-level tasks only. Specific and actionable, 2-4 steps max. Never repeat an idea from the ideas history.

Reply with ONLY JSON: { "title": "...", "why": "one sentence - the payoff", "steps": ["step 1", "step 2"], "effort": "e.g. 10 minutes", "impact": "e.g. long-tail search traffic" }`,
    { maxTokens: 600, temperature: 0.9 });
  const idea = extractJson(raw);
  if (!idea?.title) return null;
  await db.collection('marketingIdeas').add({
    ...idea, status: 'new', date: londonNow().date, createdAt: new Date().toISOString()
  });
  return idea;
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
  // Two events every day: an autonomous play AND an idea for Nathan.
  const [decision, idea] = await Promise.all([
    decide(context).catch(e => { console.error('[Marketing] decision call failed:', e.message); return null; }),
    generateIdeaForNathan(context).catch(e => { console.warn('[Marketing] idea generation failed:', e.message); return null; })
  ]);

  // Research pass: if it asked for a page, fetch it and let it refine the
  // play with real data (real contact addresses beat guessed ones).
  let pageText = null;
  if (decision?.researchUrl) {
    pageText = await fetchResearchPage(decision.researchUrl);
    if (pageText) {
      try {
        const refined = await refineWithResearch(context, decision, pageText);
        if (refined && EXECUTORS[refined.action]) decision = refined;
      } catch (e) { console.warn('[Marketing] refine pass failed:', e.message); }
    }
  }

  const missing = decision && EXECUTORS[decision.action] ? payloadMissing(decision) : [];
  if (!decision || !EXECUTORS[decision.action] || missing.length) {
    // AI failed, picked rest, or skipped required fields - log + report
    const why = !decision ? 'decision parse failed'
      : !EXECUTORS[decision.action] && decision.action !== 'rest' ? `unknown action "${decision.action}"`
      : decision.action === 'rest' ? `rested: ${decision.reason || ''}`
      : `missing fields: ${missing.join(', ')}`;
    await logAction({ type: 'rest', title: why, summary: decision?.reason || 'Claude returned no usable decision' });
    await sendDailyReport({ decision: decision || { action: 'rest', reason: why }, followups }).catch(e => console.warn('[Marketing] report failed:', e.message));
    return { action: 'rest', reason: decision?.reason || why, followups, idea };
  }

  let result;
  try {
    result = await EXECUTORS[decision.action](decision, pageText);
  } catch (e) {
    console.error('[Marketing] executor failed:', decision.action, e.message);
    await logAction({ type: decision.action, title: decision.playName || 'Action failed', summary: e.message, emailSent: false });
    await sendDailyReport({ decision, error: e.message, followups }).catch(() => {});
    return { action: decision.action, error: e.message, followups, idea };
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
  console.log(`[Marketing] daily play: ${decision.playName || decision.action} - ${decision.reason}${idea ? ` | idea for Nathan: ${idea.title}` : ''}`);
  return { action: decision.action, reason: decision.reason, result, followups, idea };
}

module.exports = { runDaily, runFollowupSweep, recordLead };
