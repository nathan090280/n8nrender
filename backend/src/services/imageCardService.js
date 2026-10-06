const sharp = require('sharp');

// Renders branded 1080x1080 tip cards as PNG. Square works everywhere:
// Instagram requires an image, and FB/Mastodon/Bluesky all favor one.
// Cards are generated on demand at /public/media/tip/<slug>.png so every
// social API gets a public URL to fetch, and tip pages get a real og:image.

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function tipCardSvg({ title, excerpt }) {
  const titleLines = wrapText(title, 20).slice(0, 3);
  const excerptLines = wrapText(excerpt, 44).slice(0, 4);
  const titleBlock = titleLines.map((l, i) =>
    `<text x="90" y="${330 + i * 92}" font-size="82" font-weight="800" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(l)}</text>`
  ).join('');
  const excerptBlock = excerptLines.map((l, i) =>
    `<text x="92" y="${330 + titleLines.length * 92 + 40 + i * 52}" font-size="40" fill="rgba(255,255,255,0.85)" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(l)}</text>`
  ).join('');

  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <circle cx="980" cy="120" r="300" fill="rgba(255,255,255,0.06)"/>
  <circle cx="60" cy="1010" r="260" fill="rgba(0,0,0,0.08)"/>
  <text x="90" y="140" font-size="34" font-weight="700" letter-spacing="6" fill="rgba(255,255,255,0.7)" font-family="DejaVu Sans, Arial, sans-serif">SUPERSPEECH TIPS</text>
  <rect x="90" y="180" width="140" height="8" rx="4" fill="rgba(255,255,255,0.6)"/>
  ${titleBlock}
  ${excerptBlock}
  <text x="90" y="1010" font-size="34" font-weight="700" fill="rgba(255,255,255,0.9)" font-family="DejaVu Sans, Arial, sans-serif">superspeech.biz</text>
</svg>`;
}

// Palette rotation - cards shouldn't all look identical in a feed.
// Same headline always picks the same theme (deterministic by string hash),
// so every platform's fetch of one post's card URL renders identically.
const THEMES = [
  { from: '#2563eb', to: '#7c3aed', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: 'rgba(255,255,255,0.6)', brand: 'rgba(255,255,255,0.9)' },
  { from: '#7c3aed', to: '#db2777', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: 'rgba(255,255,255,0.6)', brand: 'rgba(255,255,255,0.9)' },
  { from: '#0d9488', to: '#2563eb', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: 'rgba(255,255,255,0.6)', brand: 'rgba(255,255,255,0.9)' },
  { from: '#1e293b', to: '#334155', fg: '#ffffff', sub: 'rgba(255,255,255,0.8)', accent: '#93c5fd', brand: 'rgba(255,255,255,0.9)' },
  { from: '#f8fafc', to: '#e0e7ff', fg: '#1e293b', sub: 'rgba(30,41,59,0.75)', accent: '#7c3aed', brand: '#2563eb', light: true },
  { from: '#f59e0b', to: '#dc2626', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: 'rgba(255,255,255,0.6)', brand: 'rgba(255,255,255,0.9)' },
  { from: '#059669', to: '#166534', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: 'rgba(255,255,255,0.6)', brand: 'rgba(255,255,255,0.9)' },
  { from: '#be123c', to: '#f97316', fg: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: 'rgba(255,255,255,0.6)', brand: 'rgba(255,255,255,0.9)' }
];

function themeFor(text) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return THEMES[h % THEMES.length];
}

// Explicit index (e.g. day-of-year rotation carried in the card URL).
function themeAt(idx) {
  const i = parseInt(idx, 10);
  return Number.isInteger(i) && i >= 0 && i < THEMES.length ? THEMES[i] : null;
}

// Social card variant for brand/engagement posts (hooks, jokes, polls, etc.)
function brandCardSvg({ headline, sub, theme }) {
  const t = theme || themeFor(headline);
  const headlineLines = wrapText(headline, 18).slice(0, 3);
  const subLines = wrapText(sub, 40).slice(0, 4);
  const deco = t.light
    ? `<circle cx="980" cy="120" r="300" fill="rgba(124,58,237,0.08)"/><circle cx="60" cy="1010" r="260" fill="rgba(37,99,235,0.07)"/>`
    : `<circle cx="980" cy="120" r="300" fill="rgba(255,255,255,0.06)"/><circle cx="60" cy="1010" r="260" fill="rgba(0,0,0,0.08)"/>`;
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.from}"/>
      <stop offset="1" stop-color="${t.to}"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  ${deco}
  <text x="90" y="200" font-size="54" font-weight="800" fill="${t.fg}" font-family="DejaVu Sans, Arial, sans-serif">SuperSpeech</text>
  <rect x="90" y="240" width="140" height="8" rx="4" fill="${t.accent}"/>
  ${headlineLines.map((l, i) => `<text x="90" y="${420 + i * 96}" font-size="84" font-weight="800" fill="${t.fg}" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(l)}</text>`).join('')}
  ${subLines.map((l, i) => `<text x="92" y="${420 + headlineLines.length * 96 + 50 + i * 54}" font-size="42" fill="${t.sub}" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(l)}</text>`).join('')}
  <text x="90" y="1010" font-size="34" font-weight="700" fill="${t.brand}" font-family="DejaVu Sans, Arial, sans-serif">superspeech.biz</text>
</svg>`;
}

// format: 'png' (default) or 'jpeg' - Instagram's media container API is
// picky about formats, so social posting can request /media/*.jpg variants.
async function renderCard(svg, format = 'png') {
  const img = sharp(Buffer.from(svg));
  return format === 'jpeg' ? img.jpeg({ quality: 90 }).toBuffer() : img.png().toBuffer();
}

module.exports = { tipCardSvg, brandCardSvg, renderCard, themeAt, THEME_COUNT: THEMES.length };
