const { db, admin } = require('../config/firebase');
const { londonNow } = require('../utils/londonTime');

// Fire-and-forget page counters: siteStats/<YYYY-MM-DD> for daily figures
// and siteStats/_totals for lifetime. Never throws - a stat write must not
// break a page render.
function track(metric) {
  try {
    const date = londonNow().date;
    const inc = { [metric]: admin.firestore.FieldValue.increment(1) };
    db.collection('siteStats').doc(date)
      .set({ ...inc, date }, { merge: true })
      .catch(e => console.warn('stats write failed:', e.message));
    db.collection('siteStats').doc('_totals')
      .set(inc, { merge: true })
      .catch(e => console.warn('stats totals write failed:', e.message));
  } catch { /* ignore */ }
}

async function getToday() {
  try {
    const doc = await db.collection('siteStats').doc(londonNow().date).get();
    return doc.exists ? doc.data() : {};
  } catch { return {}; }
}

async function getLifetime() {
  try {
    const doc = await db.collection('siteStats').doc('_totals').get();
    return doc.exists ? doc.data() : {};
  } catch { return {}; }
}

module.exports = { track, getToday, getLifetime };
