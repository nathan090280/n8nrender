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

YOUR JOB: pick the single highest-value marketing action for today. Vary it day to day - don't repeat the same action type two days running unless the others make no sense.`;

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

// Cold outreach is NEVER sent automatically - the draft goes to Nathan to
// review and send from his own mailbox.
async function execOutreachDraft(payload) {
  const html = [
    `<p><b>Agent note:</b> cold outreach draft for you to review and send manually. Reasoning: <i>${payload.reason || ''}</i></p>`,
    `<p><b>Suggested target type:</b> ${payload.targetType || ''}</p>`,
    `<hr>`,
    `<p><b>Subject:</b> ${payload.subject || ''}</p>`,
    ...String(payload.body || '').split(/\n+/).filter(Boolean)
      .map(p => `<p style="margin:0 0 14px;line-height:1.6;">${p}</p>`)
  ].join('');
  await emailService.transporter.sendMail({
    from: `SuperSpeech Marketing Agent <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
    to: AGENT_EMAIL,
    subject: `[Marketing Agent] Outreach draft: ${payload.targetType || 'new target'}`,
    html
  });
  return { draftedFor: payload.targetType, subject: payload.subject };
}

// Tip-page idea, fully drafted, parked for review in Firestore.
async function execTipDraft(payload) {
  await db.collection('tipDrafts').add({
    title: payload.title || 'Untitled',
    slug: (payload.title || 'tip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    bodyHtml: payload.html || '',
    status: 'draft',
    source: 'marketing-agent',
    createdAt: new Date().toISOString()
  });
  return { draftTitle: payload.title, parkedIn: 'tipDrafts' };
}

const EXECUTORS = {
  newsletter: execNewsletter,
  outreach_draft: execOutreachDraft,
  tip_draft: execTipDraft
};

// --- the daily decision -----------------------------------------------------

function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function decide(context) {
  const prompt = `${context}

Reply with ONLY a JSON object choosing today's ONE action:
{
  "action": "newsletter" | "outreach_draft" | "tip_draft" | "rest",
  "reason": "one sentence why this is today's best move",
  // newsletter: { "subject": "...", "text": "plain text body", "html": "<p>..</p> short html body, no outer wrapper" }
  // outreach_draft: { "targetType": "e.g. UK wedding directories", "subject": "...", "body": "email text Nathan would send" }
  // tip_draft: { "title": "page title like 'Groom Speech: 7 Lines That Always Land'", "html": "<h2>/<p> article body, genuinely useful, 400-600 words" }
  // rest: only if every option is clearly pointless today
}
Pick "rest" sparingly - there's almost always something worth doing. Keep newsletter bodies under 250 words, warm and useful, one soft mention of the service at most.`;

  const raw = await aiService.generateSocialCopy(prompt, { maxTokens: 1600, temperature: 0.8 });
  return extractJson(raw);
}

async function buildContext() {
  const [acts, subs, candidates, newsletterGap] = await Promise.all([
    recentActions(15), subscriberCount(), followupCandidates(), lastNewsletterDaysAgo()
  ]);
  const history = acts.length
    ? acts.map(a => `- ${a.date} [${a.type}] ${a.title || a.summary || ''}`).join('\n')
    : 'No marketing actions recorded yet - this is day one.';
  return `HISTORY (most recent first):
${history}

CURRENT STATE:
- Mailing-list subscribers: ${subs}
- Days since last newsletter: ${newsletterGap === Infinity ? 'never sent' : Math.floor(newsletterGap)}
- Customers eligible for follow-up (handled automatically, don't pick this): ${candidates.length}
- Newsletter cooldown: needs >= ${NEWSLETTER_MIN_GAP_DAYS} days between sends${newsletterGap < NEWSLETTER_MIN_GAP_DAYS ? ' - DO NOT pick newsletter today' : ''}`;
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

async function runDaily() {
  const now = londonNow();

  // Follow-ups first - they run alongside, not instead of, the daily action.
  const followups = await runFollowupSweep();

  if (await actionRanToday(now.date)) {
    return { skipped: 'already acted today', followups };
  }

  const context = await buildContext();
  let decision;
  try { decision = await decide(context); }
  catch (e) { console.error('[Marketing] decision call failed:', e.message); }

  if (!decision || !EXECUTORS[decision.action]) {
    // AI failed or picked rest - log and move on rather than forcing it
    await logAction({
      type: 'rest',
      title: decision?.action === 'rest' ? `Rested: ${decision.reason}` : 'No action (decision parse failed)',
      summary: decision?.reason || 'Claude returned no usable decision'
    });
    return { action: 'rest', reason: decision?.reason, followups };
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

module.exports = { runDaily, runFollowupSweep };
