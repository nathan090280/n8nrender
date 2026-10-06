const dns = require('dns').promises;
const vm = require('vm');
const axios = require('axios');
const { db } = require('../config/store');
const aiService = require('./aiService');
const emailService = require('./emailService');
const env = require('../config/env');
const { londonNow } = require('../utils/londonTime');

// The Williams Quantum Business Development Engine - ported from the
// SuperSpeech "daily play" marketing agent. One fresh play per day at
// AGENT_HOUR:AGENT_MINUTE UK: researches an industry target for the
// invention portfolio, sends ONE verified outreach email (BCC'd to the
// principal), and continues replies with full conversation memory.
//
// THE CONTRACT GATE: the engine negotiates up to - but never into -
// commercial terms. The moment a conversation touches pricing, royalties,
// exclusivity, licensing fees, NDAs or anything contractual, it parks the
// thread, drafts a reply, and emails the principal for a one-word
// Approved/Rejected decision. Nothing contractual ever sends unapproved.

const OWNER_EMAIL = env.APPROVER_EMAILS?.split(',')[0]?.trim()
  || env.EMAIL_FROM || 'products@williamsquantum.com';
const SELF = (env.EMAIL_FROM || 'products@williamsquantum.com').toLowerCase();

const AGENT_CONTEXT = `You are the autonomous Business Development Engine for Williams Quantum (williamsquantum.com), a deep-tech invention lab run by a single principal. Emails come from products@williamsquantum.com.

BUSINESS FACTS:
- Williams Quantum develops proprietary hardware concepts to working-prototype stage and licenses them to industry partners. We do NOT sell retail, offer jobs, consulting, or custom contract work.
- Portfolio and target industries (all concept-stage, available for licensing):
  * SENTINEL CAP (WQ-001): combination-lock drink cover - drop it over a glass, spin the dial, drink is sealed until the owner returns. Anti-drink-spiking device for pubs, bars, festivals, universities. Targets: pub groups and breweries, festival/event operators, hospitality suppliers, drinkware manufacturers, student unions, safety charities.
  * PITTASAFE (WQ-002): steam-safe pitta pocket cutter - spring-loaded grips clamp hot bread on a heat-resistant base while a low-profile stainless tonearm saw, operated from an overhead slider knob, slices a clean pocket. Hands stay above the steam plume; inward-facing blade guarded at rest. Targets: kitchenware OEMs, kitchen gadget brands, cookware companies, kitchen-tool distributors.
  * ORBITCUT (WQ-003): anti-"avocado hand" prep station - fruit presses onto a guarded rotary cutting wheel, one rotation scores a perfect circumference around the stone; also fits citrus and round fruit. Targets: kitchenware OEMs, kitchen gadget brands, housewares retailers' own-brand programmes.
  * BATHBUDDY (WQ-004): all-mechanical hand-cranked bath foam cannon - crank drives a single impeller through a two-cog bevel set, whipping bath water and soap into dense foam; zero electrics near water, dual safety meshes, transparent STEM-display shell. Targets: bath toy and water toy manufacturers, toy OEMs, giftware brands, baby/child product distributors.
  * UP AND ATOM (WQ-005, SHIPPED - playable at upandatom.netlify.app): educational chemistry browser game - collect subatomic particles, build elements, complete the periodic table, craft real molecules, global scoreboard. Targets: edtech platforms, game publishers, learning brands, curriculum providers.
  * VANLIFE STARTMATE (WQ-006): plug-and-play inline soft-starter for campervans and off-grid power - sits between a 240V inverter and a demanding appliance, ramps voltage over ~1.5-2.5s to cut startup inrush by a targeted ~60-70%, letting small budget inverters run compressor fridges, blenders and tools without tripping. ~800W continuous, fused UK plug in, child-safe socket out, tri-colour status LEDs, rugged aluminium shell, zero wiring. Targets: campervan/motorhome conversion companies, leisure-vehicle and caravan accessory brands, portable power station manufacturers, off-grid equipment OEMs and distributors.
  * THE NON-PREACHY VEGAN HANDBOOK (WQ-007, BOOK - manuscript in final stages, print-ready on a publishing deal): pocket-size humour gift book - 100 short, fun, practical vegan survival tips across 10 categories (kitchen hacks, accidentally-vegan products, wardrobe/bathroom stealth checks, family dinners, BBQs, conversation comebacks, workplace, dining out, travel, long-term thriving), every tip a tight Problem -> Solution page. Stocking-filler/gift-book format, zero lecturing. Targets: humour and gift-book publishers, acquisitions editors, illustrated/lifestyle imprints, gift and stationery ranges.
- The pitch: license the concept, manufacture under agreement, Williams Quantum gets royalty. Commercial intake is products@williamsquantum.com; williamsquantum.com shows the portfolio.
- Product page URLs (use in pitches): https://williamsquantum.com/products/sentinel-cap | /products/pittasafe | /products/orbitcut | /products/bathbuddy | /products/upandatom | /products/startmate | /products/veganhandbook
- Voice: precise, confident, engineer-to-engineer. British English. Short emails, one clear ask, zero hype.

PITCH DOCTRINE - how you sell:
- You are an elite, protective BD employee working for the principal. The goal is HITS: replies, interest checks, NDA requests, letters of intent. The principal supplies the innovation; the partner handles development, manufacturing and distribution. Never imply WQ manufactures anything.
- Two exits you steer toward (never quote terms yourself - the contract gate owns numbers): one-time IP acquisition, or an advance against a percentage royalty.
- Software plays (UP AND ATOM): speed-to-market pitch - the build exists and is playable today; angle is dropping it into their ecosystem or catalogue. Aim at product managers, CTOs, edtech/content buyers.
- Hardware plays: high-concept IP pitch - fresh revenue stream, proven market gap, low upfront design friction for them. Aim at R&D heads, brand managers, category buyers.
- Book plays (THE NON-PREACHY VEGAN HANDBOOK): manuscript in final stages, print-ready on a deal - pitch the gift/stocking-filler retail lane and the under-served vegan gifting audience. Aim at acquisitions editors, humour/gift-book imprints, gift-range buyers.
- Every cold email is FOMO storytelling in three acts: (1) their world - the status quo the product addresses, (2) the tension - what existing products fail to fix and why it costs them, (3) the reveal - our concept resolves it, and the easy next step for them to be part of it. Speak to what THEY care about - market size, category growth, competitive edge - never our excitement.
- Subjects: "<Product> - Product Pitch" in title case; a short parenthetical hook may follow (e.g. "BathBuddy - Product Pitch (Foam Cannon For Bath Time)"). Hyper-personal where a name is known, never spammy.
- Greeting: "Dear Mr/Ms <Surname>," ONLY when the recipient's real name is known from research; otherwise a clean generic opener like "Hello," or "Good morning," — NEVER "Dear Mr or Mrs". Then a standalone body header line "Product Pitch - <Product>".
- Always include the product's page URL prominently in the body so they can click straight through (e.g. "See it here: https://williamsquantum.com/products/bathbuddy").
- Body: under 150 words, entirely their benefit, ONE low-friction CTA ("open to a 1-page overview?"). No jargon dumps, no secret sauce revealed, no desperation.
- Send timing: prefer targets whose local time will land inside 10:00-11:30 or 13:30-15:00 when the email arrives - adjust for the recipient's country. Never pick recipients who would receive it 08:00-09:30, 11:45-13:00, or after 16:00 their local time.

YOUR JOB: invent ONE fresh business-development play every day and execute it COMPLETELY ALONE. The principal wants INGENUITY - new angles, new industries, new entry points - not repeats of plays in the history.

ABSOLUTE RULES - breaking these is failure:
- The principal does ZERO work and NEVER appears personally: no calls, meetings, demos, conferences, "let's jump on a call". Everything happens over email. If a play needs a human presence, DON'T PICK IT.
- You can NEVER change the website, pricing position, or portfolio. You cannot sign, quote, or commit to ANYTHING commercial - the contract gate handles that separately.
- Your tools are exactly: send ONE email, fetch ONE page for research, run ONE small script. A play you complete is worth ten you can't.
- Never email the same address twice. Real, established domains only - STRONGLY prefer researchUrl to find the REAL published contact rather than guessing.
- Emails are signed "Williams Quantum - Commercial Development", never a fake person.`;

// Brand guard: block hallucinated product names and retail/consumer framing.
const PHANTOM_NAMES = /\b(sentinel\s?pro|quantumshield|guardiancap|drinksafe|spikeblock|locktop|sipguard|pocketsaw)\b/i;
const FORBIDDEN_TOPICS = /\b(buy now|discount|retail price|free sample|consumer|amazon|kickstarter|shop now|pre-?order|order now|order today)\b/gi;

function brandCheck(text, { requireMention = false } = {}) {
  const t = String(text || '');
  const bad = t.match(PHANTOM_NAMES);
  if (bad) return `hallucinated product name "${bad[0]}"`;
  const topic = t.match(FORBIDDEN_TOPICS);
  if (topic) return `forbidden topic: "${topic[0]}"`;
  if (requireMention && !/williams\s*quantum/i.test(t)) return 'never mentions Williams Quantum';
  return null;
}

// CONTRACT GATE detectors.
// Inbound language that moves the thread into commercial terms → escalate.
const CONTRACT_STAGE = /\b(contract|agreement|terms|royalt|exclusiv|licen[cs]e fee|licen[cs]ing fee|pricing|price per|unit cost|quote|NDA|non[- ]?disclosure|MOU|LOI|letter of intent|sign(ed|ing)?|legal|draft terms|heads of terms|commercial proposal|buy[- ]?out|acqui|minimum volume|territor)/i;
// Outbound drafts that accidentally commit to numbers/terms → hold for approval.
const COMMITMENT = /(£|\$|€)\s?\d|\b\d+(\.\d+)?\s?%|\broyalt(y|ies)\s+of\b|\bexclusiv(e|ity)\s+(licen[cs]e|rights|grant)\b|\bper[- ]unit\b|\bwe (offer|propose|agree|accept|commit|guarantee)\b|\bminimum (order|volume|fee)\b|\bNDA attached\b/i;

const requiresApproval = (text) => CONTRACT_STAGE.test(String(text || ''));

function daysOld(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

// --- context ---------------------------------------------------------------

async function recentActions(limit = 15) {
  try {
    const snap = await db.collection('agentActions')
      .orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map(d => d.data());
  } catch { return []; }
}

async function actionRanToday(londonDate) {
  const acts = await recentActions(10);
  return acts.some(a => a.date === londonDate && a.type !== 'note');
}

async function leadCount() {
  try { return (await db.collection('leads').get()).size; } catch { return 0; }
}

async function logAction(entry) {
  const now = londonNow();
  const doc = { date: now.date, createdAt: new Date().toISOString(), ...entry };
  await db.collection('agentActions').add(doc);
  return doc;
}

// --- leads -----------------------------------------------------------------

async function alreadyEmailedCold(email) {
  const acts = await recentActions(300);
  return acts.some(a => a.targetEmail === email);
}

async function recordLead({ email, name, subject, body, source, strategy }) {
  email = String(email || '').toLowerCase();
  const snap = await db.collection('leads').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    await snap.docs[0].ref.update({
      lastContactedAt: new Date().toISOString(),
      contactCount: (snap.docs[0].data().contactCount || 1) + 1
    });
    return snap.docs[0].id;
  }
  const ref = await db.collection('leads').add({
    email, name: name || '',
    source: source || 'agent-outreach',
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

async function findLead(email) {
  const snap = await db.collection('leads')
    .where('email', '==', String(email || '').toLowerCase()).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// --- the contract gate -------------------------------------------------------

// A lead conversation reached commercial terms. Park the thread: store the
// agent's drafted reply, flip the lead to awaiting_approval, and email the
// principal. The lead gets a holding reply - never the drafted terms.
async function escalateForApproval(lead, { from, subject, text, draft }) {
  const summary = `Lead "${lead.name || lead.email}" (${lead.email}) moved to contract stage. ` +
    `Thread so far: pitched "${lead.strategy || 'portfolio outreach'}", ${(lead.replies || []).length} replies exchanged. ` +
    `Latest message triggered gate on commercial terms.`;

  await db.collection('pendingApprovals').add({
    leadEmail: lead.email,
    leadName: lead.name || '',
    subject,
    theirMessage: String(text || '').slice(0, 3000),
    draftReply: draft,
    summary,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  const leadSnap = await db.collection('leads').where('email', '==', lead.email).limit(1).get();
  if (!leadSnap.empty) await leadSnap.docs[0].ref.update({ status: 'awaiting_approval' });

  await emailService.sendApprovalRequest({
    leadEmail: lead.email, leadName: lead.name,
    subject, proposedReply: draft, contextSummary: summary
  });

  await logAction({
    type: 'contract_gate',
    title: `Approval requested: ${lead.name || lead.email}`,
    targetEmail: lead.email,
    summary
  });
}

// Generate the next reply in a lead thread. Returns:
//   { reply }                      - safe to send now
//   { held: { draft, reason } }    - contract stage: escalate, do NOT send
async function generateLeadReply(lead, { from, subject, text }) {
  const history = (lead.replies || [])
    .map(r => `- ${r.at}: "${r.snippet}"`).join('\n') || '- (first reply)';

  const contractStage = requiresApproval(`${subject}\n${text}`);

  const prompt = `${AGENT_CONTEXT}

You emailed this lead as part of the play "${lead.strategy || 'outreach'}".
What we sent them:
Subject: ${lead.lastSubject || '(unknown)'}
Body: ${lead.lastBodySnippet || '(unknown)'}

Their replies so far:
${history}

They just emailed again:
Subject: ${subject}
From: ${from}
Body:
${String(text || '').slice(0, 3000)}

${contractStage
  ? `THIS THREAD IS AT CONTRACT STAGE. Draft the reply you WOULD send - it goes to the principal for approval first, not to the lead. Propose concrete but conservative terms (e.g. "typical structure is an upfront option fee plus a per-unit royalty in the 3-7% band, territory-scoped"). Frame everything as "proposed / subject to contract".`
  : `Write the reply email body as Williams Quantum Commercial Development:
- Continue the actual conversation - you remember everything above, never act like a stranger
- Answer questions directly; the goal is a licensing conversation or a technical briefing
- You MAY describe the portfolio, share williamsquantum.com, explain the licensing model generally, and agree to send technical summaries
- HARD LIMITS: NEVER quote prices, royalties, percentages, unit costs, exclusivity, territories, timelines with numbers, or legal terms. NEVER agree to calls/meetings - offer email or a written briefing instead. If they push for terms, say the principal confirms all commercial specifics personally and steer back to substance.
- Keep it short and precise: 4-8 sentences, engineer-to-engineer tone`}

Plain text body only, no subject line:`;

  const raw = await aiService.generateSocialCopy(prompt, { maxTokens: 600, temperature: 0.5 });
  const draft = String(raw || '').trim();

  if (contractStage) {
    return { held: { draft, reason: 'inbound hit contract-stage language' } };
  }
  // Outbound safety: if the draft itself commits to terms, hold it too.
  if (COMMITMENT.test(draft)) {
    return { held: { draft, reason: 'draft contained commercial commitments' } };
  }
  return { reply: draft };
}

// --- executors ---------------------------------------------------------------

const SENT_EMAIL_HTML = (body) => String(body || '').split(/\n+/).filter(Boolean)
  .map(p => `<p style="margin:0 0 14px;line-height:1.6;">${p}</p>`).join('');

async function domainAcceptsMail(email) {
  const domain = String(email || '').split('@')[1];
  if (!domain) return false;
  try { return (await dns.resolveMx(domain)).length > 0; }
  catch { return false; }
}

async function execDailyPlay(payload, pageText) {
  const out = { playName: payload.playName, summary: payload.summary, strategy: payload.strategy };

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
  let validShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  const isSelf = to === SELF;
  let domain = to.split('@')[1] || '';

  // Self-heal a bad address from the target's own site.
  if (complete && (!validShape || isSelf)) {
    const url = payload.targetUrl || payload.researchUrl;
    if (url) {
      try { domain = new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
      catch { domain = ''; }
    }
    if (domain) {
      const found = await findRealAddress(domain);
      if (found && !(await alreadyEmailedCold(found))) {
        to = found; validShape = true;
        out.healedAddress = { fromSite: domain, found };
      }
    }
  }

  if (complete && validShape && !isSelf) {
    const fromResearch = !!(pageText && pageText.toLowerCase().includes(to));
    if (!fromResearch && domain) {
      const found = await findRealAddress(domain);
      if (found && found !== to && !(await alreadyEmailedCold(found))) {
        out.healedAddress = { guessed: to, found };
        to = found;
      }
    }
  }

  const brandFail = complete
    ? brandCheck(`${payload.subject}\n${payload.body}`, { requireMention: true })
    : null;
  // The daily COLD email may never carry commercial commitments either.
  const commitFail = complete && COMMITMENT.test(payload.body)
    ? 'draft committed to commercial terms' : null;

  if (complete && validShape && !isSelf && !brandFail && !commitFail
      && !(await alreadyEmailedCold(to))
      && (out.healedAddress || (pageText && pageText.toLowerCase().includes(to)) || await domainAcceptsMail(to))) {
    await emailService.transporter.sendMail({
      from: `Williams Quantum <${SELF}>`,
      to,
      subject: payload.subject,
      text: String(payload.body),
      html: SENT_EMAIL_HTML(payload.body),
      bcc: OWNER_EMAIL
    });
    await recordLead({
      email: to, name: payload.targetName,
      subject: payload.subject, body: payload.body,
      source: 'agent-daily-play', strategy: payload.strategy
    });
    out.emailSent = { to, subject: payload.subject };
    return out;
  }

  const why = !complete ? 'email fields incomplete'
    : brandFail ? `off-brand draft: ${brandFail}`
    : commitFail ? `gate blocked draft: ${commitFail}`
    : !validShape ? 'no valid address supplied'
    : isSelf ? 'target was our own address'
    : await alreadyEmailedCold(to) ? 'already contacted'
    : 'domain does not accept mail (no MX records)';
  out.emailNotSent = why;

  if (complete) {
    await emailService.transporter.sendMail({
      from: `WQ Agent Core <${SELF}>`,
      to: OWNER_EMAIL,
      subject: `[WQ Agent] Outreach draft (not sent): ${payload.targetName || 'new target'}`,
      html: [
        `<p><b>Agent note:</b> couldn't find a working address - NOT sent (${why}). Reply "Approved" to send it anyway.</p>`,
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

const EXECUTORS = { daily_play: execDailyPlay };

// --- agent tools ---------------------------------------------------------------

async function fetchResearchPage(url) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|\[::1\])/.test(u.hostname)) return null;
    const res = await axios.get(u.toString(), {
      timeout: 15000,
      maxContentLength: 512 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WilliamsQuantumBot/1.0)' },
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
    console.warn('[Agent] research fetch failed:', String(url).slice(0, 100), e.message);
    return null;
  }
}

function runAgentScript(code, input) {
  try {
    const sandbox = { input, result: null, log: [] };
    sandbox.console = { log: (...a) => sandbox.log.push(a.map(String).join(' ')) };
    vm.createContext(sandbox);
    vm.runInContext(`result = (function(input){ ${code} })(input)`, sandbox, { timeout: 3000 });
    return { result: sandbox.result, log: sandbox.log.slice(0, 20) };
  } catch (e) {
    return { error: e.message };
  }
}

async function findRealAddress(domain) {
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const path of ['/contact', '/contact-us', '/about', '']) {
    const text = await fetchResearchPage(`https://${domain}${path}`);
    if (!text) continue;
    for (const found of (text.match(emailRe) || [])) {
      const e = found.toLowerCase();
      if (e === SELF) continue;
      if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(e)) continue;
      if (await domainAcceptsMail(e)) return e;
    }
  }
  return null;
}

async function refineWithResearch(context, draft, pageText) {
  const raw = await aiService.generateSocialCopy(
    `${context}

You drafted this play:
${JSON.stringify(draft, null, 1)}

Here is the actual text of the page you asked to research:
---
${pageText}
---

Return the FINAL play as a JSON object - same fields. Use REAL facts from the page (a real published email beats a guessed one; if the page shows no usable contact, change the plan or drop the email). If the page was useless, say so in "summary" and adjust.`,
    { maxTokens: 1600, temperature: 0.7 });
  return extractJson(raw);
}

// --- daily report ---------------------------------------------------------------

async function sendDailyReport({ decision, result, error }) {
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
    if (decision.researchUrl) blocks.push(p(`<b>Researched:</b> ${esc(decision.researchUrl)}`));
    if (result?.emailSent) {
      blocks.push(p(`<b>Email sent to</b> ${esc(result.emailSent.to)} - subject: "${esc(result.emailSent.subject)}" (BCC'd to you)`));
      if (decision.body) blocks.push(`<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:8px;margin:14px 0;">${SENT_EMAIL_HTML(esc(decision.body))}</div>`);
    }
    if (result?.healedAddress) blocks.push(p(`<b>Self-healed:</b> found real address ${esc(result.healedAddress.found)} on their site`));
    if (result?.emailNotSent) blocks.push(p(`Email couldn't send (${esc(result.emailNotSent)}) - draft emailed to you for approval.`));
  }

  await emailService.transporter.sendMail({
    from: `WQ Agent Core <${SELF}>`,
    to: OWNER_EMAIL,
    subject: `[WQ Agent] Today's play: ${decision?.playName || decision?.action || 'none'}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1e293b;">${blocks.join('')}</div>`
  });
}

// --- the daily decision -----------------------------------------------------

function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function buildContext() {
  const [acts, leads] = await Promise.all([recentActions(15), leadCount()]);
  const history = acts.length
    ? acts.map(a => `- ${a.date} [${a.type}] ${a.title || a.summary || ''}`).join('\n')
    : 'No actions recorded yet - this is day one.';
  return `${AGENT_CONTEXT}

HISTORY (most recent first - do NOT repeat these plays):
${history}

CURRENT STATE:
- Leads contacted: ${leads}
- Portfolio licensing priorities: rotate across the whole portfolio - hardware concepts target their respective industries; UP AND ATOM targets edtech/games publishing.`;
}

async function decide(context) {
  const prompt = `${context}

Reply with ONLY a JSON object - flat shape, all fields at the TOP LEVEL:
{
  "action": "daily_play" | "rest",
  "playName": "short catchy name",
  "reason": "one sentence why this is today's best move",
  "summary": "2-3 sentences: what, how, expected outcome"
}
- daily_play: plus any optional tools:
  * "researchUrl" - a real page to fetch BEFORE finalising (e.g. a pub group's contact page). You get the text and one refine pass.
  * "script" - small JS function body, gets {input}, returns via return statement. Pure compute only.
  * IF the play sends one real email: "targetName", "targetEmail" (a REAL verified-style address) or "targetUrl" to scrape one, "strategy" (e.g. "licensing pitch", "distribution intro"), "subject" ("<Product> - Product Pitch" title case, optional parenthetical hook), "body" (under 150 words, opens "Dear Mr/Ms <Surname>," only if a real name was found - otherwise "Hello," - then a "Product Pitch - <Product>" header line, the product page URL prominently, three-act FOMO arc per the doctrine, entirely their benefit, ONE low-friction CTA, signed "Williams Quantum - Commercial Development"). NEVER include prices/percentages/terms in a cold email.
- rest: only if genuinely nothing is worth doing today

Pick ONE portfolio product and ONE industry angle per day. Surprise the principal - no repeats.`;

  const raw = await aiService.generateSocialCopy(prompt, { maxTokens: 1600, temperature: 0.8 });
  const parsed = extractJson(raw);
  if (!parsed) console.warn('[Agent] decision parse failed, raw:', String(raw).slice(0, 500));
  return parsed;
}

function payloadMissing(d) {
  const need = { daily_play: ['playName', 'reason', 'summary'], rest: [] }[d.action] || ['__unknown_action__'];
  return need.filter(k => !d[k]);
}

async function runDaily({ force = false } = {}) {
  const now = londonNow();

  if (!force && await actionRanToday(now.date)) {
    return { skipped: 'already acted today' };
  }

  const context = await buildContext();
  const decision = await decide(context).catch(e => {
    console.error('[Agent] decision call failed:', e.message);
    return null;
  });

  let pageText = null;
  if (decision?.researchUrl) {
    pageText = await fetchResearchPage(decision.researchUrl);
    if (pageText) {
      try {
        const refined = await refineWithResearch(context, decision, pageText);
        if (refined && EXECUTORS[refined.action]) decision = refined;
      } catch (e) { console.warn('[Agent] refine pass failed:', e.message); }
    }
  }

  const missing = decision && EXECUTORS[decision.action] ? payloadMissing(decision) : [];
  const playText = `${decision?.playName || ''} ${decision?.reason || ''} ${decision?.summary || ''}`;
  const topicFail = decision?.action === 'daily_play' ? brandCheck(playText) : null;

  if (!decision || !EXECUTORS[decision.action] || missing.length || topicFail) {
    const why = !decision ? 'decision parse failed'
      : topicFail ? `off-brand play rejected: ${topicFail}`
      : !EXECUTORS[decision.action] && decision.action !== 'rest' ? `unknown action "${decision.action}"`
      : decision.action === 'rest' ? `rested: ${decision.reason || ''}`
      : `missing fields: ${missing.join(', ')}`;
    await logAction({ type: 'rest', title: why, summary: decision?.reason || 'no usable decision' });
    await sendDailyReport({ decision: decision || { action: 'rest', reason: why } }).catch(e => console.warn('[Agent] report failed:', e.message));
    return { action: 'rest', reason: decision?.reason || why };
  }

  let result;
  try {
    result = await EXECUTORS[decision.action](decision, pageText);
  } catch (e) {
    console.error('[Agent] executor failed:', decision.action, e.message);
    await logAction({ type: decision.action, title: decision.playName || 'Action failed', summary: e.message, emailSent: false });
    await sendDailyReport({ decision, error: e.message }).catch(() => {});
    return { action: decision.action, error: e.message };
  }

  await logAction({
    type: decision.action,
    title: decision.playName || decision.action,
    summary: decision.reason,
    detail: { ...result, summary: decision.summary, strategy: decision.strategy },
    targetEmail: result.emailSent?.to,
    emailSent: !!result.emailSent
  });
  await sendDailyReport({ decision, result }).catch(e => console.warn('[Agent] report failed:', e.message));
  console.log(`[Agent] daily play: ${decision.playName || decision.action} - ${decision.reason}`);
  return { action: decision.action, reason: decision.reason, result };
}

module.exports = {
  runDaily, recordLead, findLead, generateLeadReply,
  escalateForApproval, brandCheck, requiresApproval, recentActions
};
