const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { createFakeRedis } = require('./helpers/fake-redis');
const { TownEventGrantService } = require('../dist/apps/api/src/modules/town-event/town-event-grant.service');

const prize = { itemId: 'mat_divine_shard', quantity: 1 };
function setup({ addItem, sendSystemMail }) {
  const redis = createFakeRedis();
  const calls = { add: [], mail: [], mailNotice: [], locks: [], known: [] };
  const inventory = { addItem: async (...args) => { calls.add.push(args); return addItem(...args); }, rememberKnownItem: async (...args) => { calls.known.push(args); } };
  const mail = { sendSystemMail: async (...args) => { calls.mail.push(args); return sendSystemMail(...args); } };
  const gateway = { publishMailNewItem: async (...args) => calls.mailNotice.push(args) };
  const battle = { withCharacterQueueLock: async (id, op) => { calls.locks.push(id); return op(); } };
  const dataSource = { transaction: async (fn) => fn({ manager: true }) };
  const svc = new TownEventGrantService(redis, dataSource, inventory, mail, battle, gateway);
  svc.logger = { error: () => undefined, warn: () => undefined };
  return { svc, redis, calls };
}
const key = 'smashing-spree:ss-1:map_town:v007';

(async () => {
  {
    const { svc, calls } = setup({ addItem: async () => ({ id: 'row' }), sendSystemMail: async () => ({ id: 'm' }) });
    assert.equal(await svc.grant('c1', 'ss-1', 'map_town', 'v007', prize), 'bag');
    assert.deepEqual(calls.add[0].slice(0, 4), ['c1', 'mat_divine_shard', 1, 'inventory']);
    assert.ok(calls.add[0][5], 'runs inside a transaction manager');
    // The prize becomes known (Gambit item options) in the same transaction as the grant.
    assert.deepEqual(calls.known.map((args) => args.slice(0, 2)), [['c1', 'mat_divine_shard']]);
    assert.equal(calls.known[0][2], calls.add[0][5], 'same transaction manager');
    assert.deepEqual(calls.locks, ['c1']);
    assert.equal(calls.mail.length, 0);
  }
  for (const failure of [new BadRequestException('No available slots'), new Error('db down')]) {
    const { svc, calls } = setup({ addItem: async () => { throw failure; }, sendSystemMail: async () => ({ id: 'm1' }) });
    assert.equal(await svc.grant('c1', 'ss-1', 'map_town', 'v007', prize), 'mail');
    const [recipient, subject, body, gold, attachment, manager, sourceKey] = calls.mail[0];
    assert.equal(recipient, 'c1'); assert.equal(subject, 'Smashing Spree prize');
    assert.equal(body, 'Your bag was full, so your Smashing Spree prize is waiting here.');
    assert.equal(gold, undefined); assert.deepEqual(attachment, { itemId: 'mat_divine_shard', quantity: 1 }); assert.equal(manager, undefined);
    assert.equal(sourceKey, key);
    assert.equal(calls.mailNotice.length, 1); assert.equal(calls.mailNotice[0][0], 'c1'); assert.equal(calls.mailNotice[0][1].mailId, 'm1');
  }
  {
    const { svc, calls } = setup({ addItem: async () => { throw new Error('full'); }, sendSystemMail: async () => ({ id: 'm1' }) });
    await svc.grant('c1', 'ss-1', 'map_town', 'v007', prize); await svc.grant('c1', 'ss-1', 'map_town', 'v007', prize);
    assert.equal(calls.mail[0][6], calls.mail[1][6], 'same sourceKey on repeat');
  }
  {
    const { svc, redis } = setup({ addItem: async () => { throw new Error('full'); }, sendSystemMail: async () => { throw new Error('mail down'); } });
    assert.equal(await svc.grant('c1', 'ss-1', 'map_town', 'v007', prize), 'pending');
    const rows = await redis.lrange('ss:pendingGrants', 0, -1);
    assert.equal(rows.length, 1);
    const row = JSON.parse(rows[0]);
    assert.equal(row.characterId, 'c1'); assert.equal(row.vaseId, 'v007'); assert.deepEqual(row.prize, prize); assert.equal(row.sourceKey, key);
  }
  console.log('town-event-grant passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
