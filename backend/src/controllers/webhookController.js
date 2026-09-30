const aiService = require('../services/aiService');
const emailService = require('../services/emailService');
const firebaseService = require('../services/firebaseService');
const { processInboundEmail } = require('../services/inboundEmailService');

async function handleQuestionnaireCompletion(req, res) {
  try {
    const questionnaireData = req.body;
    
    const logEmail = questionnaireData.customer ? questionnaireData.customer.email : questionnaireData.email;
    console.log('Received questionnaire completion:', { email: logEmail, occasion: questionnaireData.occasionType, tone: questionnaireData.tone });
    
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
      speakerName: name, // Person giving the speech
      recipientName: questionnaireData.questionnaire?.subjectNames || name, // Subject(s) of the speech
      subjectNames: questionnaireData.questionnaire?.subjectNames || name, // For couples/honorees
      relationship: questionnaireData.questionnaire?.relationship || 'friend',
      package: questionnaireData.order?.package,
      tone: questionnaireData.order?.tone || 'serious', // Pass tone from order
      category: questionnaireData.order?.category,
      duration: questionnaireData.order?.package === 'keynote' ? 5 : (questionnaireData.order?.package === 'speech' ? 4 : 3),
      audienceSize: 'medium',
      questionnaire: questionnaireData.questionnaire || {} // Pass full questionnaire object
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
      userEmail: email,  // For dashboard query
      recipientEmail: email,
      recipientName: name,
      speechContent,
      occasionType: normalizedData.occasionType,
      metadata: speechResult.metadata
    };
    
    await firebaseService.saveSpeech(userId, speechData);
    
    // Try to send email but don't fail the whole request if it fails
    let emailSent = false;
    let emailMessageId = null;
    try {
      console.log('Sending speech email to:', email);
      const emailResult = await emailService.sendSpeechEmail(
        email,
        name,
        speechContent,
        normalizedData.occasionType
      );
      emailSent = true;
      emailMessageId = emailResult.messageId;
      console.log('✓ Email sent successfully');
    } catch (emailError) {
      console.error('⚠️ Email failed but continuing:', emailError.message);
    }
    
    await firebaseService.updateQuestionnaireStatus(
      savedQuestionnaire.questionnaireId,
      'completed',
      { 
        speechSent: emailSent,
        emailSentAt: emailSent ? new Date().toISOString() : null,
        emailMessageId: emailMessageId
      }
    );
    
    if (userId) {
      await firebaseService.saveDashboardData(userId, {
        type: 'speech_generated',
        speechContent,
        occasionType: normalizedData.occasionType,
        recipientName: name,
        emailSent: emailSent
      });
    }
    
    return res.json({
      success: true,
      message: emailSent ? 'Speech generated and sent successfully' : 'Speech generated and saved (email failed)',
      questionnaireId: savedQuestionnaire.questionnaireId,
      emailSent: emailSent,
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
    
    console.log('Received incoming email:', { from: emailData.from, subject: emailData.subject });
    
    const { from, subject, text, html } = emailData;

    if (!from || (!text && !html)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required email fields'
      });
    }

    await processInboundEmail({ from, subject, text, html });

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

async function handleEditRequest(req, res) {
  try {
    const { speechId, originalSpeech, editRequest, userEmail, packageTier, editCount } = req.body;
    
    console.log('Received edit request for speech:', speechId);
    
    if (!speechId || !originalSpeech || !editRequest || !userEmail) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    // Enforce package edit limits server-side (Toast 3 / Main 5 / Keynote 7)
    const EDIT_LIMITS = {
      toast: 3, basic: 3, tier1: 3,
      main: 5, speech: 5, standard: 5, tier2: 5,
      keynote: 7, premium: 7, tier3: 7
    };
    
    const speech = await firebaseService.getSpeechById(speechId);
    if (!speech) {
      return res.status(404).json({ success: false, error: 'Speech not found' });
    }
    
    // Resolve the package tier: request value first, then the original order
    let pkg = packageTier;
    if (!pkg && speech.questionnaireId) {
      try {
        const questionnaire = await firebaseService.getQuestionnaireById(speech.questionnaireId);
        pkg = questionnaire && (questionnaire.package || (questionnaire.order && questionnaire.order.package));
      } catch (e) {
        console.warn('Could not look up questionnaire for edit limit:', e.message);
      }
    }
    const maxEdits = EDIT_LIMITS[pkg] || 3;
    
    // Count edits in this speech's chain (each edit is its own document),
    // also honour any legacy in-place editCount on the record
    const rootId = speech.rootSpeechId || speechId;
    const chainEdits = await firebaseService.countEditsForChain(rootId);
    const usedEdits = Math.max(chainEdits, speech.editCount || 0);
    
    if (usedEdits >= maxEdits) {
      return res.status(403).json({
        success: false,
        error: 'Edit limit reached',
        message: `This package includes ${maxEdits} edits and all have been used.`,
        editCount: usedEdits,
        maxEdits
      });
    }
    
    const newEditCount = usedEdits + 1;
    
    // Generate edited speech using AI
    const editedSpeech = await aiService.editSpeech(originalSpeech, editRequest);
    
    // Save the edited speech as a NEW dashboard entry (original stays untouched)
    const saved = await firebaseService.saveEditedSpeech(speechId, {
      speechContent: editedSpeech,
      editCount: newEditCount,
      editRequest: editRequest
    });
    
    // Send email with updated speech
    await emailService.sendUpdatedSpeech(userEmail, editedSpeech, newEditCount);
    
    console.log('Speech edited and sent successfully');
    
    return res.json({
      success: true,
      message: 'Speech edited successfully',
      editCount: newEditCount,
      editedSpeech: editedSpeech,
      newSpeechId: saved.speechId
    });
  } catch (error) {
    console.error('Edit request error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function handleContactForm(req, res) {
  try {
    const { name, email, subject, message } = req.body;
    
    console.log('Received contact form:', { name, email, subject });
    
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    // Generate AI reply
    const aiReply = await aiService.generateContactReply(subject, message);
    
    // Send reply to user
    await emailService.sendContactReply(email, name, subject, message, aiReply);
    
    // Send copy to business email
    await emailService.sendContactCopyToBusiness(name, email, subject, message, aiReply);
    
    // Save to Firebase for dashboard (if user is logged in)
    if (req.body.userId) {
      await firebaseService.saveContactInteraction({
        userId: req.body.userId,
        name,
        email,
        subject,
        message,
        aiReply,
        createdAt: new Date().toISOString()
      });
    }
    
    console.log('Contact form processed and reply sent');
    
    return res.json({
      success: true,
      message: 'Thank you for your message. We\'ve sent a reply to your email.',
      reply: aiReply
    });
  } catch (error) {
    console.error('Contact form error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
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
  handleEditRequest,
  handleContactForm,
  handleTestWebhook
};
