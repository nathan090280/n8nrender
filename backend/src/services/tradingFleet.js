const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = '/app/trading';
const STATE = process.env.TRADING_STATE_DIR || '/data';
const PYTHON = process.env.TRADING_PYTHON || '/opt/venv/bin/python';
const SHUTDOWN_GRACE_MS = 5000;

const PEERS = [
  '15m=http://127.0.0.1:8378',
  'new=http://127.0.0.1:8379',
  'claude=http://127.0.0.1:8380',
  'claude15=http://127.0.0.1:8381',
  'swing=http://127.0.0.1:8382',
  'short=http://127.0.0.1:8383',
  'ranger=http://127.0.0.1:8384',
  'grokky=http://127.0.0.1:8385'
].join(',');

const orchestrators = [
  { name: 'main', port: 8377, config: 'config.yaml' },
  { name: '15m', port: 8378, config: 'config-15m.yaml' },
  { name: 'new', port: 8379, config: 'config-new.yaml' },
  { name: 'claude', port: 8380, config: 'config-claude.yaml' },
  { name: 'claude15', port: 8381, config: 'config-claude15.yaml' },
  { name: 'swing', port: 8382, config: 'config-swing.yaml' }
];

const standalone = [
  { name: 'longshort', port: 8383, module: 'scalperbot.short_bot' },
  { name: 'ranger', port: 8384, module: 'scalperbot.ranger_bot' },
  { name: 'grokky', port: 8385, module: 'scalperbot.grokky_bot' }
];

const qualifications = {
  main: 'qualification.json',
  '15m': 'qualification.json',
  new: 'qualification-new.json',
  claude: 'qualification-claude.json',
  claude15: 'qualification-claude.json',
  swing: 'qualification-swing.json'
};

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

  const common = {
    BOT_MODE: process.env.TRADING_BOT_MODE || 'live',
    DB_PATH: path.join(STATE, 'scalperbot.db'),
    QUALIFICATION_FILE: path.join(STATE, 'qualification.json')
  };

  for (const bot of orchestrators) {
    startChild(bot.name, ['-u', 'main.py', 'run'], {
      ...common,
      BOT_NAME: bot.name,
      CONFIG_PATH: path.join(ROOT, bot.config),
      DASHBOARD_PORT: String(bot.port),
      QUALIFICATION_FILE: path.join(
        STATE, qualifications[bot.name] || 'qualification.json'),
      PEER_BOTS: bot.name === 'main' ? PEERS : ''
    });
  }

  for (const bot of standalone) {
    const extra = {
      ...common,
      PORT: String(bot.port),
      POS_PATH: path.join(STATE, `${bot.name}_positions.json`)
    };
    if (bot.name === 'longshort') {
      extra.POS_PATH = path.join(STATE, 'longshort_positions.json');
      extra.LIVE_LONG = process.env.TRADING_LIVE_LONG || '1';
      extra.LIVE_SHORT = process.env.TRADING_LIVE_SHORT || '1';
    } else if (bot.name === 'ranger') {
      extra.POS_PATH = path.join(STATE, 'ranger_positions.json');
      extra.LIVE = process.env.TRADING_RANGER_LIVE || '1';
    } else {
      extra.POS_PATH = path.join(STATE, 'grokky_positions.json');
      extra.DAY_LOSS_CAP = process.env.GROKKY_DAY_LOSS_CAP || '-2.60';
    }
    startChild(bot.name, ['-u', '-m', bot.module], extra);
  }

  if (process.env.ENABLE_TRADING_COLLECTOR === 'true') {
    startChild('collector', ['-u', '-m', 'scalperbot.collector'], {
      DB_PATH: path.join(STATE, 'reservoir.db')
    });
  }

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log('[trading] fleet processes launched on shared persistent state');
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
