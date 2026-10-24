const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CharacterService } = require('../dist/apps/api/src/modules/character/character.service.js');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service.js');
const { Character, BattleQueueEntry, InventoryItem } = require('../dist/apps/api/src/database/entities/index.js');
const { BattleEngine } = require('@nanommo/shared');

function baseCharacter(overrides = {}) {
  return {
    id: 'char-offbattle-1', userId: 'user-offbattle-1', name: 'OffBattle',
    status: 'grinding', currentMapId: 'map_green_grounds_1', level: 1,
    str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5,
    hpCurrent: 10, spCurrent: 10, gold: 0, xp: 0, unspentAttributePoints: 0,
    diet: [], dietLevels: {}, activeFoodBuff: null, statusEffects: [], activeTempBuffs: [],
    consumableCooldowns: {}, cookingSession: null,
    regenAnchorAt: new Date(0), resourceRegenAt: new Date(0), createdAt: new Date(0), lastSeenAt: new Date(0),
    ...overrides,
  };
}

function makeBattleQuery({ activeBattle = null, history = [] } = {}) {
  let queryCount = 0;
  return {
    createQueryBuilder() {
      const currentQuery = queryCount++;
      const chain = {
        where() { return chain; },
        andWhere() { return chain; },
        orderBy() { return chain; },
        getOne: async () => currentQuery === 0 ? activeBattle : null,
        getMany: async () => history,
      };
      return chain;
    },
  };
}

function makeCharacterService({ character, activeBattle = null, history = [], items = {}, now = 30_000 } = {}) {
  const query = makeBattleQuery({ activeBattle, history });
  let saveCount = 0;
  const characterRepo = {
    findOne: async () => character,
    save: async (row) => { saveCount++; Object.assign(character, row); return character; },
  };
  const manager = {
    getRepository(entity) {
      if (entity === Character || entity?.name === 'Character') return characterRepo;
      if (entity === BattleQueueEntry || entity?.name === 'BattleQueueEntry') return query;
      throw new Error(`Unexpected repository ${entity?.name ?? entity}`);
    },
    transaction: async (callback) => callback(manager),
  };
  const rootRepo = { ...characterRepo, manager, find: async () => [character] };
  const dataService = {
    getMapById: () => ({ id: character.currentMapId, type: 'grind' }),
    getItemById: (id) => items[id],
  };
  const battleService = { withCharacterQueueLock: async (_id, callback) => callback() };
  const equippedItemRepository = { find: async () => [] };
  const service = new CharacterService(rootRepo, {}, {}, equippedItemRepository, {}, dataService, battleService);
  return { service, character, get saveCount() { return saveCount; }, get rootRepo() { return rootRepo; }, now };
}

function makeInventoryHarness({ itemRows, activeBattle = null } = {}) {
  const character = baseCharacter({ hpCurrent: 10, spCurrent: 10, status: 'grinding', consumableCooldowns: {} });
  const items = itemRows.map((item, index) => ({
    id: `row-${index}`, characterId: character.id, location: 'inventory', slotIndex: index,
    quantity: 2, instanceData: null, ...item,
  }));
  const catalog = {
    pot_hp_small: { id: 'pot_hp_small', name: 'Small HP Potion', type: 'consumable', stackable: true, maxStack: 20, cooldownInSeconds: 10, effect: { type: 'heal_hp', amount: 70 } },
    pot_sp_small: { id: 'pot_sp_small', name: 'Small SP Potion', type: 'consumable', stackable: true, maxStack: 20, cooldownInSeconds: 10, effect: { type: 'heal_sp', amount: 50 } },
    antidote: { id: 'antidote', name: 'Antidote', type: 'consumable', stackable: true, maxStack: 20, cooldownInSeconds: 10, effect: { type: 'cure_status', status: 'poison' } },
    food_cheese: { id: 'food_cheese', name: 'Aged Cheese', type: 'food', stackable: true, maxStack: 20, effect: { type: 'food_buff', durationSeconds: 3600, hpRegenPerTenTicks: 8, spRegenPerTenTicks: 1 } },
  };
  let saveCount = 0;
  const characterRepo = {
    findOne: async () => character,
    save: async (row) => { saveCount++; Object.assign(character, row); return character; },
  };
  const inventoryRepo = {
    find: async (options = {}) => items.filter((row) => {
      const where = options.where ?? {};
      return Object.entries(where).every(([key, value]) => row[key] === value);
    }),
    save: async (row) => { Object.assign(items.find((current) => current.id === row.id) ?? row, row); return row; },
    remove: async (row) => { const index = items.findIndex((current) => current.id === row.id); if (index >= 0) items.splice(index, 1); return row; },
  };
  const battleQuery = {
    createQueryBuilder() {
      const chain = { where() { return chain; }, andWhere() { return chain; }, getOne: async () => activeBattle };
      return chain;
    },
  };
  const getRepository = (entity) => {
    if (entity === Character || entity?.name === 'Character') return characterRepo;
    if (entity === InventoryItem || entity?.name === 'InventoryItem') return inventoryRepo;
    if (entity === BattleQueueEntry || entity?.name === 'BattleQueueEntry') return battleQuery;
    if (entity === 'equipped_items') return { find: async () => [] };
    throw new Error(`Unexpected repository ${entity?.name ?? entity}`);
  };
  const manager = { getRepository, transaction: async (callback) => callback(manager) };
  characterRepo.manager = manager;
  inventoryRepo.manager = manager;
  const dataService = { getItemById: (id) => catalog[id], getItems: () => ({ consumables: Object.values(catalog) }) };
  const inventoryService = new InventoryService(inventoryRepo, characterRepo, dataService, { ate: async () => {} });
  return { inventoryService, character, items, get saveCount() { return saveCount; } };
}

(async () => {
  const originalNow = Date.now;
  try {
    // Only one non-battle regen boundary is outside [10s,25s]; the other two
    // 10-tick boundaries are inside the recorded fight and must not be credited.
    Date.now = () => 30_000;
    const fight = { startAt: new Date(10_000), endAt: new Date(25_000), resolved: true, outcome: 'win', cancellationReason: null, cancelledAt: null };
    const regen = makeCharacterService({ character: baseCharacter(), history: [fight], now: 30_000 });
    const stats = BattleEngine.calculateDerivedStats(1, { str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5 }, {});
    const beforeHp = regen.character.hpCurrent;
    const beforeSp = regen.character.spCurrent;
    const settled = await regen.service.applyOffBattleRegeneration(regen.character.id);
    assert.equal(settled.resourcesChanged, true);
    assert.equal(regen.character.hpCurrent, Math.min(stats.maxHp, beforeHp + stats.hpRegenPerTenTicks));
    assert.equal(regen.character.spCurrent, Math.min(stats.maxSp, beforeSp + stats.spRegenPerTenTicks));
    assert.equal(regen.character.resourceRegenAt.getTime(), 30_000);

    // Current Diet food contributes at each 10-second boundary only until its own
    // digest deadline; expired food grants no bonus while base regen continues.
    const foodDef = { id: 'food_regen_test', name: 'Regen Test Food', type: 'food', effect: { type: 'food_buff', hpRegenPerTenTicks: 5, spRegenPerTenTicks: 2 } };
    const fed = makeCharacterService({
      character: baseCharacter({ diet: [{ itemId: foodDef.id, consumedAt: new Date(0).toISOString(), digestUntil: new Date(25_000).toISOString(), dietLevel: 0 }] }),
      items: { [foodDef.id]: foodDef },
      now: 30_000,
    });
    const fedDerived = BattleEngine.calculateDerivedStats(1, { str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5 }, {});
    await fed.service.applyOffBattleRegeneration(fed.character.id);
    assert.equal(fed.character.hpCurrent, Math.min(fedDerived.maxHp, 10 + fedDerived.hpRegenPerTenTicks * 3 + 5 * 2));
    assert.equal(fed.character.spCurrent, Math.min(fedDerived.maxSp, 10 + fedDerived.spRegenPerTenTicks * 3 + 2 * 2));

    // The exact final battle boundary is still owned by the immutable battle,
    // including a loss whose post-commit Town respawn begins at 1 HP.
    const death = makeCharacterService({
      character: baseCharacter(),
      history: [{ startAt: new Date(10_000), endAt: new Date(30_000), resolved: true, outcome: 'loss', cancellationReason: null, cancelledAt: null }],
      now: 30_000,
    });
    const deathBoundary = await death.service.applyOffBattleRegeneration(death.character.id);
    assert.equal(deathBoundary.resourcesChanged, false, 'the exact loss/end boundary is not counted again as off-battle regen');
    assert.equal(death.character.hpCurrent, 10);
    assert.equal(death.character.spCurrent, 10);

    // Even an overdue started battle freezes off-battle mutation until its resolver commits.
    const active = makeCharacterService({
      character: baseCharacter(),
      activeBattle: { startAt: new Date(10_000), endAt: new Date(20_000), resolved: false },
      now: 30_000,
    });
    const activeBefore = { hp: active.character.hpCurrent, sp: active.character.spCurrent, checkpoint: active.character.resourceRegenAt.getTime() };
    const activeResult = await active.service.applyOffBattleRegeneration(active.character.id);
    assert.equal(activeResult.resourcesChanged, false);
    assert.equal(active.character.hpCurrent, activeBefore.hp);
    assert.equal(active.character.spCurrent, activeBefore.sp);
    assert.equal(active.character.resourceRegenAt.getTime(), activeBefore.checkpoint);
    assert.equal(active.saveCount, 0);

    // Manual potions are allowed in a Grind map between battles; all healing
    // potions share the catalog-defined absolute cooldown used by the simulator.
    const usable = makeInventoryHarness({ itemRows: [{ itemId: 'pot_hp_small', quantity: 2 }, { itemId: 'pot_sp_small', quantity: 2 }] });
    await usable.inventoryService.useConsumable(usable.character.id, 'pot_hp_small');
    assert.equal(usable.character.hpCurrent, 80);
    assert.equal(usable.items.find((row) => row.itemId === 'pot_hp_small').quantity, 1);
    const cooldownUntil = Date.parse(usable.character.consumableCooldowns['item:potion']);
    assert.ok(cooldownUntil >= 39_999 && cooldownUntil <= 40_001);
    await assert.rejects(
      usable.inventoryService.useConsumable(usable.character.id, 'pot_sp_small'),
      /Item is on cooldown/,
    );
    assert.equal(usable.items.find((row) => row.itemId === 'pot_sp_small').quantity, 2, 'a blocked potion is not consumed');

    // Food can be eaten off-battle on a Grind map and still rotates the canonical
    // Diet; attempting it again during digestion is rejected without consuming it.
    const foodUser = makeInventoryHarness({ itemRows: [{ itemId: 'food_cheese', quantity: 2 }] });
    await foodUser.inventoryService.useConsumable(foodUser.character.id, 'food_cheese');
    assert.equal(foodUser.items.find((row) => row.itemId === 'food_cheese').quantity, 1);
    assert.equal(foodUser.character.diet.at(-1).itemId, 'food_cheese');
    assert.ok(Date.parse(foodUser.character.diet.at(-1).digestUntil) > Date.now());

    const digestBlocked = makeInventoryHarness({ itemRows: [{ itemId: 'food_cheese', quantity: 2 }] });
    digestBlocked.character.dietLevels = { food_cheese: { level: 0, lastDigestUntil: new Date(Date.now() + 60_000).toISOString() } };
    digestBlocked.character.diet = [{ itemId: 'food_cheese', consumedAt: new Date().toISOString(), digestUntil: digestBlocked.character.dietLevels.food_cheese.lastDigestUntil, dietLevel: 0 }];
    await assert.rejects(digestBlocked.inventoryService.useConsumable(digestBlocked.character.id, 'food_cheese'), /Food is still digesting/);
    assert.equal(digestBlocked.items.find((row) => row.itemId === 'food_cheese').quantity, 2);

    // A started unresolved encounter remains the server-authoritative boundary.
    const inBattle = makeInventoryHarness({
      itemRows: [{ itemId: 'pot_hp_small', quantity: 2 }],
      activeBattle: { startAt: new Date(10_000), endAt: new Date(20_000), resolved: false },
    });
    await assert.rejects(inBattle.inventoryService.useConsumable(inBattle.character.id, 'pot_hp_small'), /outside battle/);
    assert.equal(inBattle.items[0].quantity, 2);

    // The API injects persisted deadlines into combat snapshots and the pure
    // simulator initializes its mutable countdown from that snapshot.
    const root = path.resolve(__dirname, '../src');
    const battleServiceSource = fs.readFileSync(path.join(root, 'modules/battle/battle.service.ts'), 'utf8');
    const engineSource = fs.readFileSync(path.resolve(__dirname, '../../../packages/shared/src/battle-engine/index.ts'), 'utf8');
    assert.match(battleServiceSource, /cooldowns: Object\.fromEntries\(Object\.entries\(character\.consumableCooldowns/);
    assert.match(engineSource, /const cooldowns: Record<string, number> = \{ \.\.\.\(characterSnapshot\.cooldowns \?\? \{\}\) \}/);
    assert.match(battleServiceSource, /advanceResourceRegenCheckpoint\(character, battle\.endAt\)/, 'battle resolution advances the off-battle checkpoint through its immutable end boundary');
    assert.match(battleServiceSource, /advanceResourceRegenCheckpoint\(character, new Date\(timestamp\)\)/, 'successful FLEE advances the checkpoint through its replay boundary');

    console.log('off-battle resources/cooldowns: regen excludes battle intervals, overdue battle freezes writes, grind-map potion use honors shared cooldown, and started battles remain protected');
  } finally {
    Date.now = originalNow;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
