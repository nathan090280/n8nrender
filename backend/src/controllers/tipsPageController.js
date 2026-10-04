const firebaseService = require('../services/firebaseService');
const imageCardService = require('../services/imageCardService');
const statsService = require('../services/statsService');

const SITE_URL = 'https://superspeech.biz';

// Static pages live on Netlify; this list mirrors the frontend deploy so the
// proxied sitemap keeps covering them plus dynamic tip URLs.
const STATIC_PATHS = [
  '/',
  '/achievement-celebration-speech',
  '/anniversary-party-speech',
  '/award-acceptance-speech',
  '/award-presentation-speech',
  '/baby-shower-speech',
  '/bar-bat-mitzvah-speech',
  '/best-man-speech',
  '/birthday-speech-writing',
  '/bride-speech',
  '/celebration-of-life-speech',
  '/charity-gala-speech',
  '/company-anniversary-speech',
  '/engagement-party-speech',
  '/eulogy-writing-service',
  '/father-of-the-bride-speech',
  '/graduation-speech-writing',
  '/groom-speech',
  '/keynote-speech-writing',
  '/legacy-event-speech',
  '/maid-of-honour-speech',
  '/privacy',
  '/promotion-welcome-speech',
  '/retirement-farewell-speech',
  '/retirement-party-speech',
  '/thank-you-speech-writing',
  '/tribute-to-mentor-speech',
  '/vow-renewal-speech',
  '/wedding-guest-toast'
];

function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tip';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bodyToHtml(body) {
  return escapeHtml(body)
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function excerpt(body, len = 160) {
  const clean = String(body || '').replace(/\s+/g, ' ').trim();
  return clean.length > len ? clean.slice(0, len).trimEnd() + '…' : clean;
}

const PAGE_STYLES = `
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.7; }
    .tip-header { background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; padding: 1.25rem 1.5rem; }
    .tip-header-inner { max-width: 720px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
    .tip-logo { font-size: 1.4rem; font-weight: 800; color: #fff; text-decoration: none; }
    .tip-nav a { color: rgba(255,255,255,0.9); text-decoration: none; margin-left: 1.25rem; font-weight: 600; font-size: 0.95rem; }
    .tip-nav a:hover { color: #fff; }
    .tip-wrap { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.5rem 3rem; }
    .tip-wrap h1 { font-size: 2rem; line-height: 1.25; margin-bottom: 0.5rem; }
    .tip-kicker { color: #7c3aed; font-weight: 700; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.08em; margin-bottom: 0.75rem; }
    .tip-body { margin-top: 1.25rem; font-size: 1.08rem; }
    .tip-body p { margin-bottom: 1.1rem; }
    .tip-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; display: block; text-decoration: none; color: inherit; transition: box-shadow 0.15s ease, transform 0.15s ease; }
    .tip-card:hover { box-shadow: 0 8px 20px rgba(37,99,235,0.12); transform: translateY(-1px); }
    .tip-card h2 { font-size: 1.2rem; color: #1e293b; margin-bottom: 0.35rem; }
    .tip-card p { color: #64748b; font-size: 0.95rem; }
    .tip-cta { background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 12px; color: #fff; text-align: center; padding: 2rem 1.5rem; margin-top: 2.5rem; }
    .tip-cta h2 { margin-bottom: 0.5rem; }
    .tip-cta p { opacity: 0.9; margin-bottom: 1.25rem; }
    .tip-cta a { display: inline-block; background: #fff; color: #2563eb; font-weight: 700; padding: 0.8rem 2rem; border-radius: 999px; text-decoration: none; }
    .tip-back { display: inline-block; margin-bottom: 1.5rem; color: #2563eb; text-decoration: none; font-weight: 600; }
    .tip-footer { text-align: center; color: #94a3b8; font-size: 0.85rem; padding: 2rem 1rem; }
    .tip-footer a { color: #64748b; }
    @media (max-width: 600px) { .tip-wrap h1 { font-size: 1.6rem; } }
  </style>`;

// helmet's default CSP would block the inline styles + JSON-LD on these pages,
// so the public pages get a deliberately relaxed (but still same-origin) policy.
function setPublicHeaders(res, contentType) {
  res.set('Content-Type', `${contentType}; charset=utf-8`);
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' https: data:");
}

function pageShell({ title, description, canonical, content, jsonLd, ogImage }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:image" content="${ogImage || `${SITE_URL}/images/icon-1024.png`}">
  <meta name="twitter:card" content="summary_large_image">
  ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}
  ${PAGE_STYLES}
</head>
<body>
  <header class="tip-header">
    <div class="tip-header-inner">
      <a class="tip-logo" href="/">SuperSpeech</a>
      <nav class="tip-nav"><a href="/">Home</a><a href="/tips">All Tips</a><a href="/#order">Get Your Speech</a></nav>
    </div>
  </header>
  ${content}
  <footer class="tip-footer">&copy; 2026 SuperSpeech.biz | <a href="/privacy">Privacy Policy</a></footer>
</body>
</html>`;
}

async function renderTipsIndex(req, res) {
  try {
    statsService.track('tipsIndexViews');
    const tips = await firebaseService.getPublishedTips();
    const cards = tips.map(t => `
      <a class="tip-card" href="/tips/${slugify(t.title)}">
        <h2>${escapeHtml(t.title)}</h2>
        <p>${escapeHtml(excerpt(t.body))}</p>
      </a>`).join('\n');

    const content = `
  <main class="tip-wrap">
    <p class="tip-kicker">Tips &amp; What Not to Do</p>
    <h1>Speech-Writing Tips</h1>
    <p style="color:#64748b;margin-bottom:1.75rem;">Real advice for real speeches — what works, what flops, and how to avoid the classic mistakes.</p>
    ${cards || '<p>New tips are on the way — check back soon.</p>'}
    <div class="tip-cta">
      <h2>Need a speech written for you?</h2>
      <p>Answer a few questions and get a custom speech in minutes.</p>
      <a href="/">Write My Speech</a>
    </div>
  </main>`;

    setPublicHeaders(res, 'text/html');
    res.send(pageShell({
      title: 'Speech Tips & What Not to Do | SuperSpeech',
      description: 'Practical speech-writing tips from SuperSpeech — openings, structure, delivery, and the mistakes to avoid for weddings, eulogies, birthdays and more.',
      canonical: `${SITE_URL}/tips`,
      content,
      jsonLd: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Speech Tips & What Not to Do',
        url: `${SITE_URL}/tips`
      })
    }));
  } catch (error) {
    console.error('Tips index error:', error);
    res.status(500).send('Could not load tips');
  }
}

async function renderTipPage(req, res) {
  try {
    const slug = req.params.slug;
    const tips = await firebaseService.getPublishedTips();
    const tip = tips.find(t => slugify(t.title) === slug);

    if (!tip) {
      statsService.track('tipNotFound');
      setPublicHeaders(res, 'text/html');
      res.status(404).send(pageShell({
        title: 'Tip not found | SuperSpeech',
        description: 'This tip could not be found.',
        canonical: `${SITE_URL}/tips`,
        content: `<main class="tip-wrap"><a class="tip-back" href="/tips">&larr; All tips</a><h1>Tip not found</h1><p class="tip-body">That tip doesn't exist — maybe it was renamed. <a href="/tips">See all tips</a>.</p></main>`
      }));
      return;
    }

    statsService.track('tipPageViews');
    const canonical = `${SITE_URL}/tips/${slug}`;
    const desc = excerpt(tip.body);
    const ogImage = `${SITE_URL}/media/tip/${slug}.png`;
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: tip.title,
      description: desc,
      url: canonical,
      publisher: { '@type': 'Organization', name: 'SuperSpeech', url: SITE_URL },
      ...(tip.createdAt ? { datePublished: new Date(tip.createdAt).toISOString() } : {})
    });

    const content = `
  <main class="tip-wrap">
    <a class="tip-back" href="/tips">&larr; All tips</a>
    <p class="tip-kicker">Tips &amp; What Not to Do</p>
    <h1>${escapeHtml(tip.title)}</h1>
    <article class="tip-body">${bodyToHtml(tip.body)}</article>
    <div class="tip-cta">
      <h2>Skip the writing entirely</h2>
      <p>Answer a few questions and get a custom speech in minutes.</p>
      <a href="/">Write My Speech</a>
    </div>
  </main>`;

    setPublicHeaders(res, 'text/html');
    res.send(pageShell({
      title: `${tip.title} | SuperSpeech`,
      description: desc,
      canonical,
      content,
      jsonLd,
      ogImage
    }));
  } catch (error) {
    console.error('Tip page error:', error);
    res.status(500).send('Could not load tip');
  }
}

// Serves a branded 1080x1080 card for a tip - og:image on tip pages plus
// the media URL when posting to social channels. Route carries an extension
// param (.png or .jpg) because Instagram requires a jpeg media URL.
async function renderTipCard(req, res) {
  try {
    const slug = req.params.slug;
    const ext = (req.params.ext || 'png').toLowerCase();
    const tips = await firebaseService.getPublishedTips();
    const tip = tips.find(t => slugify(t.title) === slug);
    if (!tip) return res.status(404).send('No such tip');
    statsService.track('cardFetches');

    const format = (ext === 'jpg' || ext === 'jpeg') ? 'jpeg' : 'png';
    const buf = await imageCardService.renderCard(imageCardService.tipCardSvg({
      title: tip.title,
      excerpt: excerpt(tip.body, 168)
    }), format);
    res.set('Content-Type', `image/${format === 'jpeg' ? 'jpeg' : 'png'}`);
    res.set('Cache-Control', 'public, max-age=86400'); // cards are deterministic; cache a day
    res.send(buf);
  } catch (error) {
    console.error('Tip card error:', error);
    res.status(500).send('Card render failed');
  }
}

// Generic brand card: /public/media/card.png?h=<headline>&s=<sub>
// Used by the social content engine for non-tip posts (hooks, jokes, polls).
async function renderBrandCard(req, res) {
  try {
    const ext = (req.params.ext || 'png').toLowerCase();
    const h = String(req.query.h || '').slice(0, 60);
    const s = String(req.query.s || '').slice(0, 140);
    if (!h) return res.status(400).send('Missing h (headline) param');
    statsService.track('cardFetches');

    const format = (ext === 'jpg' || ext === 'jpeg') ? 'jpeg' : 'png';
    const theme = imageCardService.themeAt(req.query.t);
    const buf = await imageCardService.renderCard(
      imageCardService.brandCardSvg({ headline: h, sub: s, theme }), format);
    res.set('Content-Type', `image/${format === 'jpeg' ? 'jpeg' : 'png'}`);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (error) {
    console.error('Brand card error:', error);
    res.status(500).send('Card render failed');
  }
}

async function renderSitemap(req, res) {
  try {
    const tips = await firebaseService.getPublishedTips();
    const urls = [
      ...STATIC_PATHS.map(p => ({ loc: `${SITE_URL}${p}`, priority: p === '/' ? '1.0' : '0.8' })),
      { loc: `${SITE_URL}/tips`, priority: '0.7' },
      ...tips.map(t => ({ loc: `${SITE_URL}/tips/${slugify(t.title)}`, priority: '0.6' }))
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>`;
    setPublicHeaders(res, 'application/xml');
    res.send(xml);
  } catch (error) {
    console.error('Sitemap error:', error);
    res.status(500).send('Could not build sitemap');
  }
}

module.exports = { renderTipsIndex, renderTipPage, renderSitemap, renderTipCard, renderBrandCard, slugify };
