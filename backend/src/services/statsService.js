const { db, admin } = require('../config/firebase');
const { londonNow } = require('../utils/londonTime');

// Fire-and-forget page counters: siteStats/<YYYY-MM-DD> gets incremented
// fields per metric. Never throws - a stat write must not break a page render.
function track(metric) {
  try {
    const date = londonNow().date;
    db.collection('siteStats').doc(date)
      .set({ [metric]: admin.firestore.FieldValue.increment(1), date },
        { merge: true })
      .catch(e => console.warn('stats write failed:', e.message));
  } catch { /* ignore */ }
}

async function getToday() {
  try {
    const doc = await db.collection('siteStats').doc(londonNow().date).get();
    return doc.exists ? doc.data() : {};
  } catch { return {}; }
}

module.exports = { track, getToday };
