// 2026-11-27 lag: a gatherer whose every encounter was fled pre-combat got an empty queue back, and the
// 500 ms party pulse regenerated it every time (~2,000 flee simulations a minute). An empty recovery
// now waits EMPTY_QUEUE_RETRY_MS before that character is tried again.
// Run after `pnpm --filter @nanommo/api build`: node apps/api/test/party-worker-empty-queue-backoff.test.js
const assert = require('node:assert/strict');
const { PartyWorkerService, EMPTY_QUEUE_RETRY_MS } = require('../dist/apps/api/src/modules/party/party-worker.service');

let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;

const calls = [];
const added = new Map([['fleer', []], ['fighter', [{ id: 'b1' }]]]);
const db = { query: async (sql) => {
  if (sql.includes('FROM parties ORDER BY')) return [];
  if (sql.includes('character_action_intents')) return [];
  if (sql.includes("c.status='grinding'")) return [{ id: 'fleer' }, { id: 'fighter' }];
  if (sql.includes('FROM party_outbox')) return [];
  return [];
} };
const worker = new PartyWorkerService(db, { tryAccepted: async () => {}, matchmake: async () => {} }, { isLocallyReady: () => true, assertReadyForProcessing: async () => {} }, {}, {}, {},
  { queueBattles: async (id) => { calls.push(id); return added.get(id); } }, {});

(async () => {
  await worker.pulse();
  assert.deepEqual(calls, ['fleer', 'fighter']);
  // Next pulses within the backoff: only the character whose queue filled is retried.
  for (let i = 0; i < 10; i++) { now += 500; await worker.pulse(); }
  assert.equal(calls.filter((id) => id === 'fleer').length, 1, 'the empty one waits');
  assert.equal(calls.filter((id) => id === 'fighter').length, 11);
  // After the backoff it is tried again.
  now += EMPTY_QUEUE_RETRY_MS;
  await worker.pulse();
  assert.equal(calls.filter((id) => id === 'fleer').length, 2);
  Date.now = realNow;
  console.log('party-worker-empty-queue-backoff: ok');
})().catch((error) => { Date.now = realNow; console.error(error); process.exitCode = 1; });
