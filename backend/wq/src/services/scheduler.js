const { londonNow } = require('../utils/londonTime');
const env = require('../config/env');

// Minute-tick scheduler (Europe/London), same pattern as the SuperSpeech
// socialScheduler: fires the daily agent play once at AGENT_HOUR:AGENT_MINUTE.
const AGENT_HOUR = parseInt(env.AGENT_HOUR || '9', 10);
const AGENT_MINUTE = parseInt(env.AGENT_MINUTE || '30', 10);

let lastRunDate = null;
let running = false;

async function tick() {
  const now = londonNow();
  if (now.hour === AGENT_HOUR && now.minute >= AGENT_MINUTE
      && lastRunDate !== now.date && !running) {
    running = true;
    lastRunDate = now.date;
    try {
      const agent = require('./agentService');
      const result = await agent.runDaily();
      console.log('[Scheduler] daily agent run:', JSON.stringify(result).slice(0, 300));
    } catch (e) {
      console.error('[Scheduler] daily agent run failed:', e.message);
      lastRunDate = null; // retry next minute
    } finally {
      running = false;
    }
  }
}

function start() {
  if (env.ENABLE_AGENT === 'false') {
    console.log('[Scheduler] agent disabled via ENABLE_AGENT=false');
    return;
  }
  console.log(`[Scheduler] armed - daily play at ${String(AGENT_HOUR).padStart(2, '0')}:${String(AGENT_MINUTE).padStart(2, '0')} Europe/London`);
  setInterval(tick, 60 * 1000).unref();
  tick();
}

module.exports = { start };
