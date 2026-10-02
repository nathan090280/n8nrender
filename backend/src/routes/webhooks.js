const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const socialPostController = require('../controllers/socialPostController');

router.post('/questionnaire-completed', webhookController.handleQuestionnaireCompletion);

router.post('/incoming-email', webhookController.handleIncomingEmail);

router.post('/edit-request', webhookController.handleEditRequest);

router.post('/contact-form', webhookController.handleContactForm);

router.post('/mailing-list', webhookController.handleMailingListSignup);

router.post('/mailing-list-send', webhookController.handleMailingListSend);

// AI social poster: generates a post from the content guide + publishes cards
router.post('/social-post', socialPostController.handleSocialPost);

// On-demand social digest email (the nightly job also calls this internally)
router.post('/social-digest', async (req, res) => {
  try {
    const digest = require('../services/socialDigestService');
    res.json({ success: true, ...(await digest.collectAndSend()) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// On-demand marketing-agent run (the 11:30 UK daily job calls this internally)
router.post('/marketing-run', async (req, res) => {
  try {
    const agent = require('../services/marketingAgentService');
    res.json({ success: true, ...(await agent.runDaily({ force: req.query.force === '1' })) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// On-demand social follow sweep (also runs inside the daily marketing run)
router.post('/follow-sweep', async (req, res) => {
  try {
    const follows = require('../services/socialFollowService');
    res.json({ success: true, ...(await follows.runFollowSweep()) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Re-email a parked tip draft to hello@ (latest if no ?id given)
router.post('/tip-draft-email', async (req, res) => {
  try {
    const { db } = require('../config/firebase');
    const emailService = require('../services/emailService');
    let doc;
    if (req.query.id) {
      doc = await db.collection('tipDrafts').doc(req.query.id).get();
    } else {
      doc = (await db.collection('tipDrafts').orderBy('createdAt', 'desc').limit(1).get()).docs[0];
    }
    if (!doc || !doc.exists) return res.status(404).json({ success: false, error: 'No draft found' });
    const d = doc.data();
    await emailService.transporter.sendMail({
      from: `SuperSpeech Marketing Agent <${process.env.EMAIL_FROM || 'hello@superspeech.biz'}>`,
      to: 'hello@superspeech.biz',
      subject: `[Marketing Agent] Tip draft: ${d.title}`,
      html: `<p><i>Draft in tipDrafts (slug: ${d.slug}) - review and publish when ready.</i></p><hr>${d.bodyHtml || ''}`
    });
    res.json({ success: true, emailed: d.title });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Human-readable lead list for Nathan - open in a browser with ?key=
router.get('/leads', async (req, res) => {
  try {
    const { db } = require('../config/firebase');
    const snap = await db.collection('marketingLeads').orderBy('lastContactedAt', 'desc').limit(200).get();
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = snap.docs.map(d => {
      const l = d.data();
      const statusColor = { contacted: '#f59e0b', replied: '#16a34a', cold: '#94a3b8' }[l.status] || '#64748b';
      const replyHtml = (l.replies || []).map(r =>
        `<div style="margin:8px 0;padding:10px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;font-size:13px;"><b>${esc(r.subject)}</b> <span style="color:#64748b;">${esc(r.at?.slice(0, 10))}</span><br>${esc(r.snippet)}</div>`
      ).join('');
      return `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;"><b>${esc(l.name || l.email)}</b><br><span style="color:#64748b;font-size:13px;">${esc(l.email)}</span></td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;"><span style="background:${statusColor};color:#fff;padding:2px 10px;border-radius:999px;font-size:12px;">${esc(l.status)}</span></td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;">${esc(l.source)}<br>contacted ${esc((l.lastContactedAt || '').slice(0, 10))} (${l.contactCount || 1}x)</td>
<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px;"><b>${esc(l.lastSubject)}</b><br><span style="color:#64748b;">${esc(l.lastBodySnippet)}</span>${replyHtml}</td></tr>`;
    }).join('');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SuperSpeech Leads</title></head>
<body style="font-family:Arial,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1e293b;">
<h1 style="color:#2563eb;">Marketing Leads</h1>
<p style="color:#64748b;">${snap.size} lead(s) - auto-updated as outreach sends and replies arrive.</p>
<table style="border-collapse:collapse;width:100%;"><tr style="background:#f1f5f9;text-align:left;"><th style="padding:10px;">Lead</th><th style="padding:10px;">Status</th><th style="padding:10px;">Source</th><th style="padding:10px;">Last outreach / replies</th></tr>${rows || '<tr><td colspan="4" style="padding:20px;color:#64748b;">No leads yet - the agent records them here.</td></tr>'}</table>
</body></html>`);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Manual triggers for the weekly content jobs (scheduler calls these too)
router.post('/publish-tip', async (req, res) => {
  try {
    const svc = require('../services/weeklyContentService');
    res.json({ success: true, ...(await svc.publishTip()) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/send-newsletter', async (req, res) => {
  try {
    const svc = require('../services/weeklyContentService');
    res.json({ success: true, ...(await svc.sendWeeklyNewsletter()) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/tips', webhookController.handleGetTips);

router.post('/test', webhookController.handleTestWebhook);
router.get('/test', webhookController.handleTestWebhook);

router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook service is healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
