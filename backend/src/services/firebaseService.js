const { db } = require('../config/firebase');

async function saveQuestionnaire(userId, questionnaireData) {
  try {
    const questionnaireRef = db.collection('questionnaires').doc();
    const data = {
      ...questionnaireData,
      userId,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    
    await questionnaireRef.set(data);
    
    return {
      success: true,
      questionnaireId: questionnaireRef.id,
      data
    };
  } catch (error) {
    console.error('Error saving questionnaire:', error);
    throw error;
  }
}

async function saveSpeech(userId, speechData) {
  try {
    const speechRef = db.collection('speeches').doc();
    const now = new Date().toISOString();
    const PROCESSING_DELAY_SECONDS = 20; // Configurable delay
    const completionTime = new Date(Date.now() + PROCESSING_DELAY_SECONDS * 1000).toISOString();
    
    const data = {
      ...speechData,
      userId,
      createdAt: now,
      status: 'in_progress',
      estimatedCompletionAt: completionTime
    };
    
    await speechRef.set(data);
    
    if (userId) {
      await db.collection('users').doc(userId).set({
        lastSpeechId: speechRef.id,
        updatedAt: now
      }, { merge: true });
    }
    
    // Schedule update to 'completed' status after delay
    setTimeout(async () => {
      try {
        await speechRef.update({
          status: 'completed',
          completedAt: new Date().toISOString()
        });
        console.log(`✓ Speech ${speechRef.id} marked as completed`);
      } catch (err) {
        console.error(`Failed to mark speech ${speechRef.id} as completed:`, err.message);
      }
    }, PROCESSING_DELAY_SECONDS * 1000);
    
    return {
      success: true,
      speechId: speechRef.id,
      data
    };
  } catch (error) {
    console.error('Error saving speech:', error);
    throw error;
  }
}

async function saveEmailInteraction(interactionData) {
  try {
    const emailRef = db.collection('emailInteractions').doc();
    const data = {
      ...interactionData,
      createdAt: new Date().toISOString()
    };
    
    await emailRef.set(data);
    
    return {
      success: true,
      interactionId: emailRef.id,
      data
    };
  } catch (error) {
    console.error('Error saving email interaction:', error);
    throw error;
  }
}

async function getUserSpeeches(userId) {
  try {
    const speechesSnapshot = await db.collection('speeches')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const speeches = [];
    speechesSnapshot.forEach(doc => {
      speeches.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return speeches;
  } catch (error) {
    console.error('Error getting user speeches:', error);
    throw error;
  }
}

async function updateQuestionnaireStatus(questionnaireId, status, additionalData = {}) {
  try {
    await db.collection('questionnaires').doc(questionnaireId).update({
      status,
      ...additionalData,
      updatedAt: new Date().toISOString()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error updating questionnaire status:', error);
    throw error;
  }
}

async function getQuestionnaireById(questionnaireId) {
  try {
    const doc = await db.collection('questionnaires').doc(questionnaireId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    return {
      id: doc.id,
      ...doc.data()
    };
  } catch (error) {
    console.error('Error getting questionnaire:', error);
    throw error;
  }
}

async function saveDashboardData(userId, dashboardData) {
  try {
    await db.collection('users').doc(userId).collection('dashboard').add({
      ...dashboardData,
      createdAt: new Date().toISOString()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error saving dashboard data:', error);
    throw error;
  }
}

module.exports = {
  saveQuestionnaire,
  saveSpeech,
  saveEmailInteraction,
  getUserSpeeches,
  updateQuestionnaireStatus,
  getQuestionnaireById,
  saveDashboardData
};
