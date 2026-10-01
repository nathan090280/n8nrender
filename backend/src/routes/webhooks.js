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
