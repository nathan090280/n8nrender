// Run this from the OLD Oregon Render Shell. It copies the WQ JSON store
// directly to the disabled Frankfurt import endpoint over HTTPS.
const fs = require('fs');

const candidates = [
  process.env.WQ_STORE_FILE,
  '/app/backend/wq/data/store.json',
  '/opt/render/project/src/wq/data/store.json'
].filter(Boolean);
const storePath = candidates.find(p => fs.existsSync(p));
if (!storePath) {
  console.error('WQ store file not found; checked configured/default paths.');
  process.exit(1);
}

const token = process.env.TRADING_MIGRATION_TOKEN;
if (!token) {
  console.error('Set TRADING_MIGRATION_TOKEN in this Render Shell first.');
  process.exit(1);
}

const bytes = fs.readFileSync(storePath);
if (bytes.length > 8 * 1024 * 1024) {
  console.error('WQ store exceeds the import endpoint 8 MB limit.');
  process.exit(1);
}
try {
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('not an object');
  }
} catch {
  console.error('WQ store file is not a valid JSON object.');
  process.exit(1);
}

(async () => {
  const url = process.env.FRANKFURT_IMPORT_URL ||
    'https://superspeech-backend-frankfurt.onrender.com/api/internal/trading-state/import';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Trading-Migration-Token': token
    },
    body: JSON.stringify({
      files: { 'wq-store.json': bytes.toString('base64') }
    })
  });
  const body = await response.text();
  console.log(`WQ state import HTTP ${response.status}: ${body}`);
  if (!response.ok) process.exitCode = 1;
})().catch(error => {
  console.error('WQ state transfer failed:', error.message);
  process.exitCode = 1;
});
