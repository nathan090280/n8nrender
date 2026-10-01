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

// Social card variant for pages/branding posts (e.g. sharing the site itself)
function brandCardSvg({ headline, sub }) {
  const headlineLines = wrapText(headline, 18).slice(0, 3);
  const subLines = wrapText(sub, 40).slice(0, 4);
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
  <text x="90" y="200" font-size="54" font-weight="800" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">SuperSpeech</text>
  <rect x="90" y="240" width="140" height="8" rx="4" fill="rgba(255,255,255,0.6)"/>
  ${headlineLines.map((l, i) => `<text x="90" y="${420 + i * 96}" font-size="84" font-weight="800" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(l)}</text>`).join('')}
  ${subLines.map((l, i) => `<text x="92" y="${420 + headlineLines.length * 96 + 50 + i * 54}" font-size="42" fill="rgba(255,255,255,0.85)" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(l)}</text>`).join('')}
  <text x="90" y="1010" font-size="34" font-weight="700" fill="rgba(255,255,255,0.9)" font-family="DejaVu Sans, Arial, sans-serif">superspeech.biz</text>
</svg>`;
}

// format: 'png' (default) or 'jpeg' - Instagram's media container API is
// picky about formats, so social posting can request /media/*.jpg variants.
async function renderCard(svg, format = 'png') {
  const img = sharp(Buffer.from(svg));
  return format === 'jpeg' ? img.jpeg({ quality: 90 }).toBuffer() : img.png().toBuffer();
}

module.exports = { tipCardSvg, brandCardSvg, renderCard };
