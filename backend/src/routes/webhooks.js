const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

router.post('/questionnaire-completed', webhookController.handleQuestionnaireCompletion);

router.post('/incoming-email', webhookController.handleIncomingEmail);

router.post('/edit-request', webhookController.handleEditRequest);

router.post('/contact-form', webhookController.handleContactForm);

router.post('/mailing-list', webhookController.handleMailingListSignup);

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
