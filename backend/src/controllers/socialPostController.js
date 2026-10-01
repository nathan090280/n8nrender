const contentEngine = require('../services/contentEngine');
const socialPostService = require('../services/socialPostService');

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
// Flow: content guide -> Claude generates concept + per-platform captions ->
// branded card URL (jpg variant for Instagram) -> publish -> record in
// Firestore so future generations avoid repeating concepts.
async function handleSocialPost(req, res) {
  try {
    const { platforms, topic, category, dryRun } = req.body || {};

    const post = await contentEngine.generatePost({ topic, category });

    // Card media URLs point at the Render origin directly - works even before
    // the Netlify /media/* proxy change deploys, and platforms just fetch it.
    const cardUrl = (ext) =>
      `https://superspeech-backend.onrender.com/public/media/card.${ext}?h=${encodeURIComponent(post.cardHeadline)}&s=${encodeURIComponent(post.cardSub || '')}`;

    const wanted = platforms && platforms.length ? platforms
      : Object.keys(socialPostService.POSTERS);

    // Map captions to platforms: IG gets its own, FB its own, short for the rest
    const captions = {
      facebook: post.captions?.facebook,
      instagram: post.captions?.instagram,
      mastodon: post.captions?.short,
      bluesky: post.captions?.short
    };

    const result = {
      success: true,
      concept: post.concept,
      category: post.category,
      card: { headline: post.cardHeadline, sub: post.cardSub },
      cardPreviewPng: cardUrl('png'),
      captions,
      dryRun: !!dryRun
    };

    if (dryRun) {
      return res.json(result);
    }

    // Instagram fetches the media URL itself and needs jpeg; the other
    // platforms take the png card.
    const results = {};
    for (const p of wanted) {
      const imageUrl = cardUrl(p === 'instagram' ? 'jpg' : 'png');
      const r = await socialPostService.publishPost({
        captions: { [p]: captions[p] },
        imageUrl,
        platforms: [p]
      });
      results[p] = r[p];
    }

    result.results = results;
    await contentEngine.recordPost(post.concept, post.category, results);
    res.json(result);
  } catch (error) {
    console.error('Social post failed:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = { handleSocialPost };
