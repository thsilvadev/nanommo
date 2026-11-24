const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const src = (p) => fs.readFileSync(path.join(root, 'apps/api/src', p), 'utf8');
const { createFakeRedis } = require('./helpers/fake-redis');
const { GatewayService, mergeObtained } = require('../dist/apps/api/src/modules/gateway/gateway.service');

(async () => {
  // Channel + payload.
  {
    const redis = createFakeRedis();
    const gw = new GatewayService(redis);
    gw.logger = { debug: () => undefined, warn: () => undefined };
    await gw.publishItemsObtained('c1', [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 0 }], 'battle');
    assert.deepEqual(redis.published, [{ channel: 'gateway:inventory:obtained:c1', payload: { items: [{ itemId: 'a', quantity: 2 }], source: 'battle' } }]);
    await gw.publishItemsObtained('c1', [], 'battle');
    await gw.publishItemsObtained('c1', [{ itemId: 'x', quantity: -1 }], 'gather');
    assert.equal(redis.published.length, 1, 'nothing to show publishes nothing');
    assert.deepEqual(mergeObtained([{ itemId: 'a', quantity: 1 }, { itemId: 'b', quantity: 1 }, { itemId: 'a', quantity: 2 }]), [{ itemId: 'a', quantity: 3 }, { itemId: 'b', quantity: 1 }]);
  }
  // Socket subscription.
  assert.ok(src('modules/gateway/nanommo.gateway.ts').includes('`gateway:inventory:obtained:${characterId}`'));
  // Emitters (part 1: battles and gathering).
  const battle = src('modules/battle/battle.service.ts');
  assert.match(battle, /publishItemsObtained\([\s\S]{0,200}?'battle'\)/);
  const party = src('modules/party/shared-battle.service.ts');
  assert.match(party, /'inventory:obtained',\{items:[\s\S]{0,160}?source:'party_battle'/);
  const map = src('modules/map/map.service.ts');
  assert.match(map, /publishItemsObtained\([\s\S]{0,200}?'gather'\)/);
  // Never for storage moves or unequip.
  const town = src('modules/town/town.service.ts');
  const withdraw = town.slice(town.search(/async (withdrawFromStorage|takeFromStorage|withdraw)\w*\(/));
  assert.ok(!/publishItemsObtained/.test(withdraw.slice(0, withdraw.indexOf('\n  async ', 10))), 'storage withdraw must not toast');
  assert.ok(!/publishItemsObtained/.test(src('modules/equipment/equipment.service.ts')), 'unequip must not toast');
  console.log('inventory-obtained-emitters passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
