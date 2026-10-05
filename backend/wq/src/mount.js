// Mounts the Williams Quantum agent core onto an existing Express app —
// i.e. the shared SuperSpeech Render service — under /wq.
//
// Self-contained tenant: own WQ_* env vars, own JSON store, own mailbox,
// own schedulers. Fails soft by design: nothing in here may take the host
// process down. The host only needs:
//
//     try { require('./wq/mount').mount(app); }
//     catch (e) { console.warn('[WQ] mount skipped:', e.message); }
//
// placed AFTER bodyParser and BEFORE the host's 404 handler.

const router = require('./app');
const emailService = require('./services/emailService');
const imapPoller = require('./services/imapPoller');
const scheduler = require('./services/scheduler');

let servicesStarted = false;

function mount(app, base = '/wq') {
  app.use(base, router);
  console.log(`[WQ] routes mounted at ${base}`);

  if (servicesStarted) return;
  servicesStarted = true;

  // Defer service start so a slow/broken mailbox can never block host boot.
  setImmediate(async () => {
    try {
      const ok = await emailService.verifyEmailConnection();
      console.log(`[WQ] email transport ${ok ? 'connected' : 'not configured'}`);
    } catch (e) {
      console.warn('[WQ] email verify failed:', e.message);
    }
    try { imapPoller.start(); } catch (e) { console.warn('[WQ] imap start failed:', e.message); }
    try { scheduler.start(); } catch (e) { console.warn('[WQ] scheduler start failed:', e.message); }
    console.log('[WQ] agent core services armed');
  });
}

module.exports = { mount };
