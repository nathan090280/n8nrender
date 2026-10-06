const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { db } = require('../config/store');

// All routes here sit behind the x-api-key middleware in server.js —
// EXCEPT POST /contact, which is the public website form (exempted there
// and rate-limited tighter here).

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many messages - try again shortly.' }
});

// Public website contact form -> inbound pipeline. The submission is fed to
// processInboundEmail exactly as if it were an email: the intake AI drafts a
// reply (contract gate still applies), it is sent to the submitter's address,
// and the thread is recorded so a follow-up email continues as a lead.
router.post('/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, company, interest, message, website } = req.body || {};

    // Honeypot: bots fill the hidden "website" field. Pretend success.
    if (website) return res.json({ success: true });

    const clean = s => String(s || '').trim();
    const cName = clean(name).slice(0, 80);
    const cEmail = clean(email).slice(0, 120);
    const cCompany = clean(company).slice(0, 120);
    const cInterest = clean(interest).slice(0, 60);
    const cMsg = clean(message).slice(0, 4000);

    if (!cName || !cMsg || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cEmail)) {
      return res.status(400).json({ success: false, error: 'Valid name, email and message are required.' });
    }

    const subject = `Williams Quantum enquiry${cInterest && cInterest !== 'general' ? ` - ${cInterest}` : ''}`;
    const text = `Website contact form submission\n\nName: ${cName}\nEmail: ${cEmail}\nCompany: ${cCompany || '-'}\nInterest: ${cInterest || 'general'}\n\n${cMsg}`;

    const { processInboundEmail } = require('../services/inboundEmailService');
    await processInboundEmail({ from: `${cName} <${cEmail}>`, subject, text });

    // Record as a lead AFTER the intake reply so this first message uses the
    // generic intake path; their next email continues via the lead engine.
    await require('../services/agentService').recordLead({
      email: cEmail, name: cName, subject, body: cMsg,
      source: 'website-form', strategy: `interest:${cInterest || 'general'}`
    });

    res.json({ success: true });
  } catch (e) {
    console.error('Contact form error:', e.message);
    res.status(500).json({ success: false, error: 'Message could not be routed. Email products@williamsquantum.com directly.' });
  }
});

// Manual trigger for the daily agent run (the scheduler also calls internally)
router.post('/agent-run', async (req, res) => {
  try {
    const agent = require('../services/agentService');
    res.json({ success: true, ...(await agent.runDaily({ force: req.query.force === '1' })) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Inbound email webhook (alternative to IMAP polling, e.g. mail forwarders)
router.post('/incoming-email', async (req, res) => {
  try {
    const { processInboundEmail } = require('../services/inboundEmailService');
    res.json({ success: true, ...(await processInboundEmail(req.body || {})) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Human-readable pipeline view - open in a browser with ?key=<API_SECRET_KEY>
router.get('/leads', async (req, res) => {
  try {
    const [leadsSnap, approvalsSnap] = await Promise.all([
      db.collection('leads').orderBy('lastContactedAt', 'desc').limit(200).get(),
      db.collection('pendingApprovals').orderBy('createdAt', 'desc').limit(50).get()
    ]);
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const colors = {
      contacted: '#f59e0b', replied: '#16a34a', negotiating: '#00D2FF',
      awaiting_approval: '#a855f7', closed: '#64748b'
    };
    const rows = leadsSnap.docs.map(d => {
      const l = d.data();
      const c = colors[l.status] || '#64748b';
      const replyHtml = (l.replies || []).map(r =>
        `<div style="margin:8px 0;padding:10px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;font-size:13px;"><b>${esc(r.subject)}</b> <span style="color:#64748b;">${esc(r.at?.slice(0, 10))}</span><br>${esc(r.snippet)}</div>`
      ).join('');
      return `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;"><b>${esc(l.name || l.email)}</b><br><span style="color:#64748b;font-size:13px;">${esc(l.email)}</span></td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;"><span style="background:${c};color:#fff;padding:2px 10px;border-radius:999px;font-size:12px;">${esc(l.status)}</span></td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;">${esc(l.source)}<br>${esc(l.strategy)}<br>${esc((l.lastContactedAt || '').slice(0, 10))} (${l.contactCount || 1}x)</td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px;"><b>${esc(l.lastSubject)}</b><br><span style="color:#64748b;">${esc(l.lastBodySnippet)}</span>${replyHtml}</td></tr>`;
    }).join('');

    const approvals = approvalsSnap.docs.map(d => {
      const a = d.data();
      return `<p><b>${esc(a.status.toUpperCase())}</b> - ${esc(a.leadName || a.leadEmail)} <span style="color:#64748b;">${esc((a.createdAt || '').slice(0, 16))}</span><br><span style="font-size:13px;color:#475569;">${esc(a.summary)}</span></p>`;
    }).join('');

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Williams Quantum - Lead Pipeline</title></head>
<body style="font-family:Arial,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1e293b;">
<h1 style="color:#0891b2;">Williams Quantum - Lead Pipeline</h1>
<p style="color:#64748b;">${leadsSnap.size} lead(s) - updated as the engine sends outreach and replies arrive.</p>
<h2 style="color:#a855f7;font-size:17px;">Contract gate</h2>
${approvals || '<p style="color:#64748b;">No approval requests yet.</p>'}
<h2 style="font-size:17px;">Leads</h2>
<table style="border-collapse:collapse;width:100%;"><tr style="background:#f1f5f9;text-align:left;"><th style="padding:10px;">Lead</th><th style="padding:10px;">Status</th><th style="padding:10px;">Source / strategy</th><th style="padding:10px;">Last outreach / replies</th></tr>${rows || '<tr><td colspan="4" style="padding:20px;color:#64748b;">No leads yet - the agent records them here.</td></tr>'}</table>
</body></html>`);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
