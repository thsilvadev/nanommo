// 2026-11-27 production freeze: encounter-chain lock waiters held pooled connections while blocked on
// pg_advisory_lock('character:<id>'), the key a party transaction (PartyService.serialized) holds with
// pg_advisory_xact_lock; that transaction needed one more pooled connection to finish -> nobody could.
// The lock now tries without blocking and returns the connection between attempts.
// Run after `pnpm --filter @nanommo/api build`: node apps/api/test/encounter-lock-pool.test.js
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service');

/** A pool of `size` connections and Postgres session advisory locks (blocking and try variants). */
function fakePostgres(size) {
  let free = size;
  const waiting = [];
  const holders = new Map(); // key -> owner id
  const lockWaiters = [];
  const stats = { maxInUse: 0, blockingCalls: 0 };
  const acquire = () => new Promise((resolve) => { if (free > 0) { free--; stats.maxInUse = Math.max(stats.maxInUse, size - free); resolve(); } else waiting.push(resolve); });
  const release = () => { const next = waiting.shift(); if (next) next(); else free++; };
  const wakeLockWaiters = () => { for (const w of lockWaiters.splice(0)) w(); };
  let ids = 0;
  const createQueryRunner = () => {
    const id = ++ids;
    let connected = false;
    return {
      manager: { id },
      async connect() { await acquire(); connected = true; },
      async release() { if (connected) { connected = false; release(); } },
      async query(sql, [key]) {
        if (sql.includes('pg_try_advisory_lock')) {
          if (holders.has(key)) return [{ locked: false }];
          holders.set(key, id); return [{ locked: true }];
        }
        if (sql.includes('pg_advisory_lock')) {
          stats.blockingCalls++;
          while (holders.has(key)) await new Promise((r) => lockWaiters.push(r));
          holders.set(key, id); return [{}];
        }
        if (sql.includes('pg_advisory_unlock')) { holders.delete(key); wakeLockWaiters(); return [{}]; }
        return [];
      },
    };
  };
  return { createQueryRunner, acquire, release, holders, stats, unlockKey: (key) => { holders.delete(key); wakeLockWaiters(); } };
}

function fakeRedis() {
  const keys = new Map();
  return {
    async set(key, value, _px, _ttl, nx) { if (nx === 'NX' && keys.has(key)) return null; keys.set(key, value); return 'OK'; },
    async eval(script, _n, key, token) { if (script.includes('del') && keys.get(key) === token) keys.delete(key); return 1; },
  };
}

function service(pg) {
  const svc = Object.create(BattleService.prototype);
  svc.redis = fakeRedis();
  svc.queueAuthority = new AsyncLocalStorage();
  svc.logger = { log() {}, error() {}, warn() {} };
  svc.characterRepo = { manager: { connection: { createQueryRunner: pg.createQueryRunner } } };
  return svc;
}

const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: still blocked after ${ms} ms (deadlock)`)), ms))]);

(async () => {
  // The freeze: pool of 2; a party transaction holds character:A on one connection and needs a second
  // one after a moment; two encounter-chain lock requests for A (different callers: Redis keys differ
  // per character, so use A and a second request queued behind it) arrive meanwhile.
  {
    const pg = fakePostgres(2);
    const svc = service(pg);
    const key = 'character:A';
    // Party transaction: takes a connection and the key, then needs another connection to finish.
    await pg.acquire(); pg.holders.set(key, 'party');
    const party = (async () => {
      await new Promise((r) => setTimeout(r, 30));
      await pg.acquire(); // e.g. buildCharacterSnapshot through the default repository
      pg.release();
      pg.unlockKey(key); pg.release();
      return 'party done';
    })();
    let ran = 0;
    const job = svc.withCharacterQueueLock('A', async () => { ran++; return 'job done'; });
    const results = await withTimeout(Promise.all([party, job]), 3000, 'party transaction + encounter lock');
    assert.deepEqual(results, ['party done', 'job done']);
    assert.equal(ran, 1);
    assert.equal(pg.stats.blockingCalls, 0, 'never waits on a blocking pg_advisory_lock');
    assert.equal(pg.holders.size, 0, 'the key is released after the operation');
  }

  // Many concurrent operations on a small pool all finish, one at a time per character, without leaking connections.
  {
    const pg = fakePostgres(3);
    const svc = service(pg);
    const order = [];
    const ops = ['A', 'B', 'A', 'C', 'B', 'A'].map((c, i) => svc.withCharacterQueueLock(c, async () => { order.push(`${c}${i}:in`); await new Promise((r) => setTimeout(r, 5)); order.push(`${c}${i}:out`); }));
    await withTimeout(Promise.all(ops), 5000, 'concurrent operations');
    for (const c of ['A', 'B', 'C']) {
      const mine = order.filter((e) => e.startsWith(c));
      for (let i = 0; i < mine.length; i += 2) assert.ok(mine[i].endsWith(':in') && mine[i + 1].endsWith(':out') && mine[i].split(':')[0] === mine[i + 1].split(':')[0], `${c} operations never overlap: ${mine.join(' ')}`);
    }
    assert.ok(pg.stats.maxInUse <= 3);
    await pg.acquire(); await pg.acquire(); await pg.acquire(); // every connection came back to the pool
  }

  console.log('encounter-lock-pool: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
