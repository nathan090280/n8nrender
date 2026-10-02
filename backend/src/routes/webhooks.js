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
