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
  // Emitters (part 2: craft, vendor, mail, quest, event prize) — after the transaction, never inside it.
  const townSrc = src('modules/town/town.service.ts');
  assert.equal((townSrc.match(/publishItemsObtained\([\s\S]{0,160}?'craft'\)/g) ?? []).length, 2, 'cooking and crafting completions');
  assert.match(townSrc, /publishItemsObtained\([\s\S]{0,160}?'vendor'\)/);
  assert.match(src('modules/mail/mail.service.ts'), /publishItemsObtained\([\s\S]{0,160}?'mail'\)/);
  assert.match(src('modules/quests/quest.service.ts'), /publishItemsObtainedVia\([\s\S]{0,200}?'quest'\)/);
  assert.match(src('modules/town-event/town-event-grant.service.ts'), /publishItemsObtained\([\s\S]{0,160}?'event'\)/);
  for (const file of ['modules/town/town.service.ts', 'modules/mail/mail.service.ts', 'modules/quests/quest.service.ts']) {
    // Every emit sits outside a `transaction(async manager => { ... })` callback: it follows a `}));` / `});` close.
    const text = src(file);
    for (const m of text.matchAll(/publishItemsObtained(Via)?\(/g)) {
      const before = text.slice(Math.max(0, m.index - 600), m.index);
      assert.ok(/\}\)\)?;?[\s\S]*$/.test(before) && !/manager\.getRepository[^\n]*\n[^\n]*$/.test(before), `${file}: emit must follow the commit`);
    }
  }
  // Event prize grant: toast on 'bag', none on 'mail'.
  {
    const { TownEventGrantService } = require('../dist/apps/api/src/modules/town-event/town-event-grant.service');
    const obtained = [];
    const make = (addItem) => new TownEventGrantService(createFakeRedis(), { transaction: async (fn) => fn({}) }, { addItem }, { sendSystemMail: async () => ({ id: 'm' }) },
      { withCharacterQueueLock: async (_id, op) => op() }, { publishMailNewItem: async () => undefined, publishItemsObtained: async (...a) => obtained.push(a) });
    const prize = { itemId: 'mat_divine_shard', quantity: 1 };
    const bag = make(async () => ({})); bag.logger = { warn() {}, error() {} };
    assert.equal(await bag.grant('c1', 'ss-1', 'map_town', 'v1', prize), 'bag');
    assert.deepEqual(obtained, [['c1', [prize], 'event']]);
    // A toast failure after the bag commit must not fall through to the mail fallback (double grant).
    let mailed = 0;
    const throwing = new TownEventGrantService(createFakeRedis(), { transaction: async (fn) => fn({}) }, { addItem: async () => ({}) }, { sendSystemMail: async () => { mailed++; return { id: 'm' }; } },
      { withCharacterQueueLock: async (_id, op) => op() }, { publishMailNewItem: async () => undefined, publishItemsObtained: async () => { throw new Error('redis down'); } });
    throwing.logger = { warn() {}, error() {} };
    assert.equal(await throwing.grant('c1', 'ss-1', 'map_town', 'v3', prize), 'bag');
    assert.equal(mailed, 0);
    const full = make(async () => { throw new Error('full'); }); full.logger = { warn() {}, error() {} };
    assert.equal(await full.grant('c1', 'ss-1', 'map_town', 'v2', prize), 'mail');
    assert.equal(obtained.length, 1);
  }
  // Mail collect: items only (gold never toasts), after commit.
  {
    const { MailService } = require('../dist/apps/api/src/modules/mail/mail.service');
    const obtained = [];
    const mail = Object.create(MailService.prototype);
    const row = { id: 'm1', recipientCharacterId: 'c1', expiresAt: new Date(Date.now() + 1e6), attachmentsCollected: false, attachedGold: 50, itemId: 'mega_elixir', quantity: 3, itemInstanceData: null };
    const repos = {
      Character: { findOne: async () => ({ id: 'c1', gold: 0, currentMapId: 'map_town', status: 'town', travelIntent: null, pendingMapTransition: null }), save: async () => undefined },
      MailMessage: { findOne: async () => row, save: async () => undefined },
      InventoryItem: { find: async () => [], save: async () => undefined, create: (x) => x },
    };
    Object.assign(mail, {
      dataService: { getItemById: () => ({ id: 'mega_elixir', stackable: true, maxStack: 20 }) },
      dataSource: { transaction: async (fn) => fn({ getRepository: (entity) => repos[entity.name] }) },
      battleService: { withCharacterQueueLock: async (_id, op) => op() },
      gateway: { publishItemsObtained: async (...a) => obtained.push(a) },
    });
    mail.settledTown = () => true;
    await mail.collectAttachments('c1', 'm1');
    assert.deepEqual(obtained, [['c1', [{ itemId: 'mega_elixir', quantity: 3 }], 'mail']]);
    row.attachmentsCollected = false; row.itemId = null; row.quantity = 0; obtained.length = 0;
    await mail.collectAttachments('c1', 'm1');
    assert.equal(obtained.length, 0, 'gold-only mail does not toast');
  }
  console.log('inventory-obtained-emitters passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
