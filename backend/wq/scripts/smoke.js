/* Offline smoke test - no API keys or mailbox needed.
   Verifies: store round-trip, module wiring, contract-gate detectors. */
require('dotenv').config();
const assert = require('assert');

(async () => {
  // 1. Store round-trip (unique email per run so repeats stay idempotent)
  const { db } = require('../src/config/store');
  const testEmail = `smoke_${Date.now()}@example.com`;
  const { id } = await db.collection('leads').add({
    email: testEmail, status: 'contacted', replies: []
  });
  await new Promise(r => setTimeout(r, 120)); // let debounced save fire
  const snap = await db.collection('leads').where('email', '==', testEmail).limit(1).get();
  assert(!snap.empty, 'lead not persisted');
  assert.strictEqual(snap.docs[0].id, id);
  await snap.docs[0].ref.update({ status: 'replied' });
  const again = await db.collection('leads').where('email', '==', testEmail).limit(1).get();
  assert.strictEqual(again.docs[0].data().status, 'replied');
  console.log('[ok] store round-trip');

  // 2. Agent module + contract-gate detectors
  const agent = require('../src/services/agentService');
  assert(agent.requiresApproval('Can you send over the contract terms?'), 'contract gate missed "contract terms"');
  assert(agent.requiresApproval('What royalty percentage do you expect?'), 'gate missed "royalty"');
  assert(!agent.requiresApproval('Interesting device, tell me more about the materials.'), 'gate false-positive');
  assert(agent.brandCheck('check out QuantumShield today')?.includes('hallucinated'), 'brand check missed phantom name');
  assert(!agent.brandCheck('licensing the Sentinel Cap from Williams Quantum'), 'brand check false-positive');
  console.log('[ok] contract gate + brand guard');

  // 3. Module wiring (no side-effectful network calls at require time)
  require('../src/services/aiService');
  require('../src/services/inboundEmailService');
  require('../src/routes/api');
  const { londonNow } = require('../src/utils/londonTime');
  assert(/\d{4}-\d{2}-\d{2}/.test(londonNow().date), 'londonNow date shape');
  console.log('[ok] module wiring');

  console.log('\nSMOKE PASS');
  process.exit(0);
})().catch(e => { console.error('SMOKE FAIL:', e); process.exit(1); });
