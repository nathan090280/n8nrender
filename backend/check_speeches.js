const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://superspeech-e7bde.firebaseapp.com'
});

const db = admin.firestore();

async function checkSpeeches() {
  try {
    const snapshot = await db.collection('speeches').orderBy('createdAt', 'desc').limit(5).get();
    
    console.log(`\nFound ${snapshot.size} speeches in Firebase:\n`);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`\n========== SPEECH ${doc.id} ==========`);
      console.log(`Created: ${data.createdAt}`);
      console.log(`User: ${data.userId}`);
      console.log(`Status: ${data.status}`);
      console.log(`\nFULL SPEECH CONTENT:`);
      console.log(data.speech || 'NO SPEECH CONTENT');
      console.log(`========================================\n`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
  process.exit(0);
}

checkSpeeches();
