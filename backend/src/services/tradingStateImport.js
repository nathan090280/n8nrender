const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.TRADING_STATE_DIR || '/data';
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set([
  'scalperbot.db',
  'qualification.json',
  'qualification-new.json',
  'qualification-claude.json',
  'qualification-swing.json',
  'grokky_positions.json',
  'grokky_state.json',
  'longshort_positions.json',
  'longshort_positions.json.state',
  'ranger_positions.json',
  'ranger_state.json',
  'short_positions.json',
  'short_positions.json.state',
  'wq-store.json'
]);

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function decodeFile(name, encoded) {
  if (!ALLOWED.has(name) || typeof encoded !== 'string') {
    throw new Error('invalid state file entry');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) {
    throw new Error('invalid base64 state file');
  }
  if (name === 'scalperbot.db' &&
      (!bytes.subarray(0, 15).equals(Buffer.from('SQLite format 3')) ||
       bytes[15] !== 0)) {
    throw new Error('invalid SQLite state database');
  }
  if (name.endsWith('.json') || name.endsWith('.json.state')) {
    const text = bytes.toString('utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('state JSON must be an object');
    }
  }
  return bytes;
}

function handle(req, res) {
  if (process.env.TRADING_STATE_IMPORT_ENABLED !== 'true') {
    return res.status(404).json({ error: 'not found' });
  }
  if (process.env.ENABLE_TRADING_FLEET === 'true' ||
      process.env.TRADING_STATE_READY === 'true') {
    return res.status(409).json({
      error: 'disable the fleet and state-ready flag before importing'
    });
  }
  if (!tokenMatches(
    req.get('x-trading-migration-token'),
    process.env.TRADING_MIGRATION_TOKEN
  )) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const files = req.body && req.body.files;
    if (!files || typeof files !== 'object' || Array.isArray(files) ||
        (!files['scalperbot.db'] && !files['wq-store.json'])) {
      return res.status(400).json({
        error: 'provide scalperbot.db or wq-store.json'
      });
    }

    const decoded = new Map();
    let total = 0;
    for (const [name, value] of Object.entries(files)) {
      const bytes = decodeFile(name, value);
      total += bytes.length;
      if (total > MAX_TOTAL_BYTES) {
        return res.status(413).json({ error: 'state snapshot too large' });
      }
      decoded.set(name, bytes);
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const nonce = crypto.randomBytes(8).toString('hex');
    const existing = new Set();
    for (const name of decoded.keys()) {
      const target = path.join(DATA_DIR, name);
      if (fs.existsSync(target)) existing.add(name);
    }

    // Preserve every pre-existing target before replacing it with the
    // explicitly uploaded snapshot. This makes retries recoverable without
    // silently destroying any files already on the persistent disk.
    let backupDirectory = null;
    if (existing.size) {
      backupDirectory = path.join(DATA_DIR, `pre-import-${Date.now()}-${nonce}`);
      fs.mkdirSync(backupDirectory, { mode: 0o700 });
      for (const name of existing) {
        fs.copyFileSync(
          path.join(DATA_DIR, name),
          path.join(backupDirectory, name),
          fs.constants.COPYFILE_EXCL
        );
      }
    }

    const staged = [];
    const installed = [];
    try {
      for (const [name, bytes] of decoded) {
        const temp = path.join(DATA_DIR, `.${name}.${nonce}.tmp`);
        fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
        staged.push([name, temp, path.join(DATA_DIR, name)]);
      }
      for (const [name, temp, target] of staged) {
        fs.renameSync(temp, target);
        installed.push(name);
      }
    } catch (error) {
      for (const [name] of staged) {
        const target = path.join(DATA_DIR, name);
        try {
          if (installed.includes(name)) {
            if (existing.has(name)) {
              fs.copyFileSync(
                path.join(backupDirectory, name), target);
            } else {
              fs.unlinkSync(target);
            }
          }
        } catch (_) { /* retain the backup for manual recovery */ }
      }
      for (const [, temp] of staged) {
        try { fs.unlinkSync(temp); } catch (_) { /* partial import cleanup */ }
      }
      throw error;
    }

    console.warn(
      `[trading] imported state files: ${Array.from(decoded.keys()).join(', ')}`
    );
    return res.json({
      ok: true,
      files: Array.from(decoded.keys()),
      backupDirectory: backupDirectory
        ? path.basename(backupDirectory)
        : null,
      bytes: total
    });
  } catch (error) {
    console.error('Trading state import rejected:', error.message);
    return res.status(400).json({ error: 'invalid state snapshot' });
  }
}

module.exports = { handle };
