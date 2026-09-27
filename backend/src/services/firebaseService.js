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
    const data = {
      ...speechData,
      userId,
      createdAt: new Date().toISOString(),
      status: 'completed'
    };
    
    await speechRef.set(data);
    
    if (userId) {
      await db.collection('users').doc(userId).set({
        lastSpeechId: speechRef.id,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
    
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
