const aiService = require('../services/aiService');
const emailService = require('../services/emailService');
const firebaseService = require('../services/firebaseService');

async function handleQuestionnaireCompletion(req, res) {
  try {
    const questionnaireData = req.body;
    
    console.log('Received questionnaire completion:', JSON.stringify(questionnaireData, null, 2));
    
    // Handle both formats: direct {email, name} and nested {customer: {email, name}}
    let email, name, userId;
    
    if (questionnaireData.customer) {
      // Frontend format
      email = questionnaireData.customer.email;
      name = questionnaireData.customer.name;
      userId = questionnaireData.userId || questionnaireData.userEmail;
    } else {
      // Direct format
      email = questionnaireData.email;
      name = questionnaireData.name;
      userId = questionnaireData.userId;
    }
    
    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email and name',
        receivedData: questionnaireData
      });
    }
    
    // Normalize data for processing
    const normalizedData = {
      ...questionnaireData,
      email,
      name,
      userId,
      occasionType: questionnaireData.order?.specificOccasion || questionnaireData.occasionType || 'special occasion',
      recipientName: name,
      speakerName: name,
      relationship: questionnaireData.questionnaire?.relationship || 'friend',
      package: questionnaireData.order?.package,
      tone: questionnaireData.order?.tone || 'heartfelt',
      category: questionnaireData.order?.category,
      duration: 3,
      audienceSize: 'medium'
    };
    
    const savedQuestionnaire = await firebaseService.saveQuestionnaire(userId, normalizedData);
    
    console.log('Generating speech with AI...');
    
    // Generate AI speech - NO FALLBACK, this is what customers are paying for!
    const speechResult = await aiService.generateSpeech(normalizedData);
    
    if (!speechResult || !speechResult.success || !speechResult.speech) {
      // AI FAILED - this is an error, not acceptable
      throw new Error('AI speech generation failed: ' + (speechResult?.error || 'No speech content returned'));
    }
    
    const speechContent = speechResult.speech;
    console.log('✓ AI speech generated successfully');
    
    const speechData = {
      questionnaireId: savedQuestionnaire.questionnaireId,
      userId,
      recipientEmail: email,
      recipientName: name,
      speechContent,
      occasionType: normalizedData.occasionType,
      metadata: speechResult.metadata
    };
    
    await firebaseService.saveSpeech(userId, speechData);
    
    console.log('Sending speech email to:', email);
    const emailResult = await emailService.sendSpeechEmail(
      email,
      name,
      speechContent,
      normalizedData.occasionType
    );
    
    await firebaseService.updateQuestionnaireStatus(
      savedQuestionnaire.questionnaireId,
      'completed',
      { 
        speechSent: true,
        emailSentAt: new Date().toISOString(),
        emailMessageId: emailResult.messageId
      }
    );
    
    if (userId) {
      await firebaseService.saveDashboardData(userId, {
        type: 'speech_generated',
        speechContent,
        occasionType: normalizedData.occasionType,
        recipientName: name,
        emailSent: true
      });
    }
    
    return res.json({
      success: true,
      message: 'Speech generated and sent successfully',
      questionnaireId: savedQuestionnaire.questionnaireId,
      emailSent: true,
      dashboardUpdated: !!userId
    });
    
  } catch (error) {
    console.error('Error handling questionnaire completion:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to process questionnaire and generate speech'
    });
  }
}

async function handleIncomingEmail(req, res) {
  try {
    const emailData = req.body;
    
    console.log('Received incoming email:', emailData);
    
    const { from, subject, text, html } = emailData;
    
    if (!from || (!text && !html)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required email fields'
      });
    }
    
    const emailContent = text || html;
    
    console.log('Generating AI reply for email from:', from);
    const replyResult = await aiService.generateEmailReply(emailContent, from, subject);
    
    let replyContent;
    if (replyResult.success) {
      replyContent = replyResult.reply;
    } else {
      console.warn('AI reply generation failed, using fallback');
      replyContent = replyResult.fallbackReply;
    }
    
    console.log('Sending auto-reply to:', from);
    const emailResult = await emailService.sendAutoReply(
      from,
      replyContent,
      `Re: ${subject || 'Your SuperSpeech Inquiry'}`
    );
    
    await firebaseService.saveEmailInteraction({
      from,
      subject,
      originalContent: emailContent,
      replyContent,
      replySent: true,
      emailMessageId: emailResult.messageId
    });
    
    return res.json({
      success: true,
      message: 'Email reply sent successfully',
      replySent: true
    });
    
  } catch (error) {
    console.error('Error handling incoming email:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to process and reply to email'
    });
  }
}

async function handleTestWebhook(req, res) {
  return res.json({
    success: true,
    message: 'Webhook endpoint is working!',
    timestamp: new Date().toISOString(),
    receivedData: req.body
  });
}

module.exports = {
  handleQuestionnaireCompletion,
  handleIncomingEmail,
  handleTestWebhook
};
