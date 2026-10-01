const { db } = require('../config/firebase');

async function saveQuestionnaire(userId, questionnaireData) {
  try {
    const questionnaireRef = db.collection('questionnaires').doc();
    const data = {
      ...questionnaireData,
      userId: userId || null,
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
      userId: userId || null,
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

async function updateSpeechWithEdit(speechId, editData) {
  try {
    const speechRef = db.collection('speeches').doc(speechId);
    const speechDoc = await speechRef.get();
    
    if (!speechDoc.exists) {
      throw new Error('Speech not found');
    }
    
    const currentData = speechDoc.data();
    const currentHistory = currentData.editHistory || [];
    
    await speechRef.update({
      speechContent: editData.speechContent,
      editCount: editData.editCount,
      editHistory: [...currentHistory, editData.editHistory],
      updatedAt: new Date().toISOString()
    });
    
    console.log(`✓ Speech ${speechId} updated with edit #${editData.editCount}`);
    
    return {
      success: true,
      speechId,
      editCount: editData.editCount
    };
  } catch (error) {
    console.error('Error updating speech with edit:', error);
    throw error;
  }
}

// Saves an AI-edited speech as a NEW entry in Completed Speeches (original stays untouched)
async function saveEditedSpeech(originalSpeechId, editData) {
  try {
    const origRef = db.collection('speeches').doc(originalSpeechId);
    const origDoc = await origRef.get();

    if (!origDoc.exists) {
      throw new Error('Speech not found');
    }

    const orig = origDoc.data();
    const now = new Date().toISOString();
    const speechRef = db.collection('speeches').doc();

    await speechRef.set({
      userId: orig.userId || null,
      userEmail: orig.userEmail || orig.recipientEmail || null,
      recipientEmail: orig.recipientEmail || orig.userEmail || null,
      recipientName: orig.recipientName || null,
      questionnaireId: orig.questionnaireId || null,
      occasionType: orig.occasionType || orig.occasion || 'Speech',
      speechContent: editData.speechContent,
      isEdit: true,
      editOf: originalSpeechId,
      rootSpeechId: orig.rootSpeechId || originalSpeechId,
      editCount: editData.editCount,
      editRequest: editData.editRequest || null,
      status: 'completed',
      createdAt: now,
      completedAt: now
    });

    console.log(`✓ Edit #${editData.editCount} saved as new speech ${speechRef.id} (from ${originalSpeechId})`);

    return {
      success: true,
      speechId: speechRef.id,
      editCount: editData.editCount
    };
  } catch (error) {
    console.error('Error saving edited speech:', error);
    throw error;
  }
}

async function getSpeechById(speechId) {
  try {
    const doc = await db.collection('speeches').doc(speechId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error getting speech:', error);
    throw error;
  }
}

// Counts every edit entry belonging to a speech chain (each edit is its own doc)
async function countEditsForChain(rootSpeechId) {
  try {
    const snapshot = await db.collection('speeches')
      .where('rootSpeechId', '==', rootSpeechId)
      .get();
    return snapshot.size;
  } catch (error) {
    console.error('Error counting edits:', error);
    throw error;
  }
}

// Marks 'in_progress' speeches as completed once their estimated window has
// passed - covers cases where the server restarted before the timer fired
async function markStaleSpeechesCompleted() {
  try {
    const snapshot = await db.collection('speeches')
      .where('status', '==', 'in_progress')
      .get();

    if (snapshot.empty) return 0;

    const now = Date.now();
    let marked = 0;

    const updates = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const due = data.estimatedCompletionAt ? new Date(data.estimatedCompletionAt).getTime() : null;
      if (!due || due <= now) {
        updates.push(doc.ref.update({
          status: 'completed',
          completedAt: data.estimatedCompletionAt || new Date().toISOString()
        }));
        marked++;
      }
    });

    await Promise.all(updates);
    if (marked > 0) console.log(`✓ Marked ${marked} stale speech(es) as completed`);
    return marked;
  } catch (error) {
    console.error('Error marking stale speeches completed:', error);
    throw error;
  }
}

async function saveContactInteraction(interactionData) {
  try {
    const contactRef = db.collection('contactInteractions').doc();
    const data = {
      ...interactionData,
      createdAt: new Date().toISOString()
    };
    
    await contactRef.set(data);
    
    // Also save to user's messages if userId provided
    if (interactionData.userId) {
      await db.collection('users').doc(interactionData.userId)
        .collection('messages').add({
          from: 'SuperSpeech Support',
          subject: interactionData.subject,
          message: interactionData.aiReply,
          originalMessage: interactionData.message,
          createdAt: data.createdAt
        });
    }
    
    console.log(`✓ Contact interaction saved`);
    
    return {
      success: true,
      interactionId: contactRef.id,
      data
    };
  } catch (error) {
    console.error('Error saving contact interaction:', error);
    throw error;
  }
}

async function saveMailingListSignup(email) {
  try {
    const existing = await db.collection('mailingList')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!existing.empty) {
      return { success: true, alreadySubscribed: true };
    }

    const ref = await db.collection('mailingList').add({
      email,
      source: 'website',
      subscribedAt: new Date().toISOString()
    });

    return { success: true, id: ref.id };
  } catch (error) {
    console.error('Error saving mailing list signup:', error);
    throw error;
  }
}

async function getPublishedTips() {
  try {
    const snapshot = await db.collection('tips')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const tips = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.published === false) return;
      tips.push({
        id: doc.id,
        title: d.title || 'Tip',
        body: d.body || '',
        createdAt: d.createdAt || null
      });
    });
    return tips;
  } catch (error) {
    console.error('Error fetching tips:', error);
    throw error;
  }
}

async function unsubscribeMailingList(email) {
  try {
    const snapshot = await db.collection('mailingList')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) return { success: false, notFound: true };

    await snapshot.docs[0].ref.update({
      unsubscribed: true,
      unsubscribedAt: new Date().toISOString()
    });
    return { success: true };
  } catch (error) {
    console.error('Error unsubscribing mailing list email:', error);
    throw error;
  }
}

async function getMailingListSubscribers() {
  try {
    const snapshot = await db.collection('mailingList').get();
    const emails = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.email && !d.unsubscribed) emails.push(d.email);
    });
    return emails;
  } catch (error) {
    console.error('Error fetching mailing list subscribers:', error);
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
  saveDashboardData,
  updateSpeechWithEdit,
  saveEditedSpeech,
  getSpeechById,
  countEditsForChain,
  markStaleSpeechesCompleted,
  saveContactInteraction,
  saveMailingListSignup,
  getPublishedTips,
  unsubscribeMailingList,
  getMailingListSubscribers
};
