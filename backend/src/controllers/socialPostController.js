const socialScheduler = require('../services/socialScheduler');

// POST /api/webhooks/social-post   (behind the shared API key, like the
// other webhook routes)
//
// Body: {
//   platforms: ['facebook','instagram','mastodon','bluesky'], // default: all configured
//   topic:    optional steer, e.g. "best man speeches"
//   category: optional guide category steer
//   dryRun:   true = generate + return the post WITHOUT publishing
// }
//
// The generation+publish flow lives in socialScheduler.runPostJob so the
// daily 18:00 UK scheduler uses exactly the same pipeline as manual calls.
async function handleSocialPost(req, res) {
  try {
    const { platforms, topic, category, dryRun, manual, themeIndex } = req.body || {};
    const result = await socialScheduler.runPostJob({ platforms, topic, category, dryRun, manual, themeIndex });
    res.json(result);
  } catch (error) {
    console.error('Social post failed:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = { handleSocialPost };
