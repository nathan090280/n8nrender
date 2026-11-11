const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = '/app/trading';
const STATE = process.env.TRADING_STATE_DIR || '/data';
const PYTHON = process.env.TRADING_PYTHON || '/opt/venv/bin/python';
const SHUTDOWN_GRACE_MS = 5000;

const GROKKY_PORT = 8385;

const children = new Map();
let stopping = false;
let started = false;

function childEnv(extra = {}) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    DB_PATH: path.join(STATE, 'scalperbot.db'),
    POS_PATH: path.join(STATE, 'positions.json'),
    DASHBOARD_HOST: '127.0.0.1',
    ...extra
  };
}

function startChild(name, args, extraEnv = {}) {
  const state = { child: null, restarts: 0, timer: null };
  children.set(name, state);

  const launch = () => {
    if (stopping) return;
    const child = spawn(PYTHON, args, {
      cwd: ROOT,
      env: childEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    state.child = child;

    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => {
        for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
          console.log(`[trading:${name}] ${line}`);
        }
      });
    }
    child.on('error', error => {
      console.error(`[trading:${name}] spawn error: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      state.child = null;
      if (stopping) return;
      state.restarts += 1;
      const delay = Math.min(30000, 1000 * (2 ** Math.min(state.restarts, 5)));
      console.error(
        `[trading:${name}] exited code=${code} signal=${signal}; restart in ${delay}ms`
      );
      state.timer = setTimeout(launch, delay);
    });
    console.log(`[trading:${name}] started pid=${child.pid}`);
  };

  launch();
}

function start() {
  if (started || process.env.ENABLE_TRADING_FLEET !== 'true' ||
      process.env.TRADING_STATE_READY !== 'true') {
    console.log(
      '[trading] disabled; enable only after credentials and state are configured'
    );
    return;
  }
  const required = [
    'KUCOIN_API_KEY', 'KUCOIN_API_SECRET', 'KUCOIN_API_PASSPHRASE',
    'KUCOIN_API_KEY2', 'KUCOIN_API_SECRET2', 'KUCOIN_API_PASSPHRASE2',
    'DASHBOARD_USER', 'DASHBOARD_PASSWORD'
  ];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    console.error(`[trading] not started; missing env names: ${missing.join(', ')}`);
    return;
  }
  started = true;
  fs.mkdirSync(STATE, { recursive: true });

  const dbPath = path.join(STATE, 'scalperbot.db');
  startChild('dashboard', ['-u', 'main.py', 'run'], {
    BOT_MODE: 'live',
    BOT_NAME: 'main',
    TRADING_DASHBOARD_ONLY: 'true',
    CONFIG_PATH: path.join(ROOT, 'config-dashboard.yaml'),
    DB_PATH: dbPath,
    QUALIFICATION_FILE: path.join(STATE, 'qualification.json'),
    DASHBOARD_PORT: '8377',
    PEER_BOTS: `grokky=http://127.0.0.1:${GROKKY_PORT}`
  });

  startChild('grokky', ['-u', '-m', 'scalperbot.grokky_bot'], {
    DB_PATH: dbPath,
    PORT: String(GROKKY_PORT),
    POS_PATH: path.join(STATE, 'grokky_positions.json'),
    DAY_LOSS_CAP: process.env.GROKKY_DAY_LOSS_CAP || '-2.60'
  });

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log('[trading] Grokky live; dashboard-only process cannot place orders');
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const state of children.values()) {
    if (state.timer) clearTimeout(state.timer);
    if (state.child) state.child.kill('SIGTERM');
  }
  const timer = setTimeout(() => {
    for (const state of children.values()) {
      if (state.child && state.child.exitCode === null) state.child.kill('SIGKILL');
    }
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  timer.unref();
}

module.exports = { start, stop };
