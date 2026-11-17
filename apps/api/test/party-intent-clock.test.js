const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '../src/modules/battle/encounter-clock.service.ts');
assert.ok(fs.existsSync(source), 'solo encounter reservations must persist independently of disposable battle projections');
const { EncounterClockService } = require('../dist/apps/api/src/modules/battle/encounter-clock.service');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service');
function database() {
  let row = null;
  let transactions = 0;
  const manager = { query: async (sql, args = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.startsWith('SELECT')) return row && row.ownerId === args[0] ? [structuredClone(row)] : [];
    if (sql.startsWith('INSERT INTO encounter_clocks')) {
      row = { ownerKind: 'character', ownerId: args[0], mapId: args[1], cycle: Number(row?.cycle ?? -1) + 1, searchStartedAt: args[2], dueAt: args[3], seed: args[4], roster: JSON.parse(args[5]), status: 'searching', generation: Number(row?.generation ?? 0) + 1 };
      return [structuredClone(row)];
    }
    if (sql.includes("SET status='consumed'")) {
      if (row?.status === 'searching' && row.ownerId === args[0] && row.seed === args[1] && new Date(row.dueAt).getTime() === new Date(args[2]).getTime()) { row.status = 'consumed'; return [{ ownerId: row.ownerId }]; }
      return [];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const db = { manager, transaction: async fn => { transactions++; return fn(manager); } };
  return { db, manager, row: () => structuredClone(row), transactions: () => transactions };
}
const projection = (overrides = {}) => ({ id: 'projection-1', characterId: 'actor-1', mapId: 'map-test', sequenceIndex: 0, monsterId: 'mon_slime', seedUsed: 'frozen-seed', startAt: new Date(5000), log: { searchStartAt: new Date(0).toISOString() }, ...overrides });
(async () => {
  const storage = database();
  const clocks = new EncounterClockService(storage.db);
  const original = await clocks.reserveProjection(projection());
  for (let index = 1; index <= 100; index++) {
    const reserved = await clocks.reserveProjection(projection({ id: `replacement-${index}`, startAt: new Date(5000 + index * 20), monsterId: 'mon_fieldbat', seedUsed: `reroll-${index}` }));
    assert.equal(new Date(reserved.dueAt).getTime(), 5000, '100 projection edits cannot extend deadline');
    assert.equal(reserved.seed, 'frozen-seed');
    assert.equal(reserved.roster[0].monsterId, 'mon_slime');
    assert.equal(reserved.generation, original.generation);
  }
  assert.equal(await clocks.consumeProjection(projection({ seedUsed: 'wrong' }), storage.manager), false, 'unrelated resolver cannot consume reservation');
  assert.equal(await clocks.consumeProjection(projection(), storage.manager), true);
  assert.equal(await clocks.consumeProjection(projection(), storage.manager), false, 'duplicate resolution is idempotent');
  const next = await clocks.reserveProjection(projection({ startAt: new Date(9000), seedUsed: 'next-seed' }));
  assert.equal(new Date(next.dueAt).getTime(), 9000);
  assert.equal(next.cycle, Number(original.cycle) + 1);
  assert.equal(next.generation, Number(original.generation) + 1);
  const txCount = storage.transactions();
  await clocks.reserveProjection(projection({ mapId: 'other-map' }), storage.manager);
  assert.equal(storage.transactions(), txCount, 'caller-supplied manager avoids nested transactions');

  // Exercise the actual invalidation boundary: capture identity before deleting its projections.
  const battle = Object.create(BattleService.prototype);
  let entries = [projection()];
  let reservedBeforeDiscard = false;
  battle.encounterClocks = { reserveProjection: async entry => { assert.equal(entries.length, 1); assert.equal(entry.seedUsed, 'frozen-seed'); reservedBeforeDiscard = true; } };
  battle.getBattleQueue = async () => entries;
  battle.discardUnresolvedBattles = async () => { assert.ok(reservedBeforeDiscard); entries = []; };
  battle.characterRepo = { findOne: async () => ({ status: 'grinding', currentMapId: 'map-test' }) };
  battle.queueBattles = async () => [];
  battle.buildAuthoritativeBattleSnapshot = async () => ({});
  battle.safePublishQueueUpdated = async () => {};
  const originalNow = Date.now;
  Date.now = () => 1000;
  try { await battle.invalidateAndRebuildFutureCombatQueue('actor-1'); } finally { Date.now = originalNow; }
  assert.ok(reservedBeforeDiscard);

  const integrationDb = database();
  const integrated = Object.create(BattleService.prototype);
  const queue = [];
  let serial = 0;
  let now = 1000;
  const food = { itemId: 'food_bread', hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, expiresAt: new Date(100000).toISOString() };
  const character = { id: 'actor-1', currentMapId: 'map-test', status: 'grinding', hpCurrent: 1000, spCurrent: 1000, level: 1, str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5, statusEffects: [], activeFoodBuff: food, diet: [], dietLevels: {}, activeGambitPageId: 'page-1', encounterCycle: {}, gatheringCycle: { progress: 0, lastUpdatedAt: new Date(0).toISOString() } };
  const monster = { id: 'mon_slime', name: 'Slime', level: 1, hp: 10, atk: 1, matk: 0, def: 0, mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 99, moveSpd: 0, isAggressive: false, xpReward: 1, drops: [], gambit: [], damageTakenMultiplier: { melee: 1, ranged: 1, magic: 1 }, weight: 100 };
  const actorSnapshot = { level: 1, hp: 1000, sp: 1000, maxHp: 1000, maxSp: 1000, atk: 1000, matk: 0, def: 0, mdefPercent: 0, accuracy: 1000, evasion: 0, critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5, luk: 5, attackSpeed: 100, castTimeReduction: 10, equippedWeaponTypes: [], skills: {}, skillDefs: {}, statusEffects: [], basicAttackRange: 0, basicAttackDamageType: 'melee', combatStyle: 'melee', moveSpeedBase: 50, foodBuffs: [{ itemId: 'food_bread', hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, remainingTicks: 180 }], foodBuffTicksRemaining: 180 };
  integrated.encounterClocks = new EncounterClockService(integrationDb.db);
  await integrated.encounterClocks.reserveProjection(projection());
  integrated.characterRepo = { findOne: async () => character, save: async value => value };
  integrated.battleQueueRepo = { create: value => value, save: async value => { const saved = { id: `battle-${++serial}`, ...value }; queue.push(saved); return saved; } };
  integrated.gambitPageRepo = { findOne: async () => ({ lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }] }) };
  integrated.getBattleQueue = async () => [...queue];
  integrated.discardUnresolvedBattles = async (_id, keepId) => { const keep = queue.filter(row => row.id === keepId); queue.splice(0, queue.length, ...keep); };
  integrated.mapPresenceService = { countActiveGrinders: async () => 1 };
  integrated.equipmentService = { getEquipment: async () => [] };
  integrated.loadCombatantLoadout = async () => ({ weaponTypes: [], equipmentStats: { statBonus: {} }, skillDefs: {}, skills: {} });
  integrated.buildCharacterSnapshot = async () => structuredClone(actorSnapshot);
  integrated.buildAuthoritativeBattleSnapshot = async () => ({});
  integrated.buildInventoryMap = async () => ({});
  integrated.getOrCreateKillCounter = async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} });
  integrated.getActiveDietFoodBuffs = () => [food];
  integrated.dataService = { getMapById: id => ({ id, type: 'grind' }), getMonstersInMap: () => [monster], getMonsterById: () => monster, getMonsterSkills: () => [], getStatusEffects: () => [], getItems: () => ({}), getItemById: () => null, getGlobalItemDrops: () => ({ drops: [] }), getWeaponBaseAttackTicks: () => 6 };
  integrated.bullQueue = { add: async () => {} };
  integrated.safePublishQueueUpdated = async () => {};
  integrated.logger = { log() {}, warn() {}, debug() {} };
  integrated.queueBattles = async () => integrated.queueBattlesLocked(character.id, 1, false);
  Date.now = () => now;
  try {
    await integrated.queueBattlesLocked(character.id, 1, false);
    for (let edit = 0; edit < 100; edit++) {
      now = 1000 + edit * 30;
      await integrated.invalidateAndRebuildFutureCombatQueue(character.id);
      assert.equal(queue[0].startAt.getTime(), 5000, 'real queue rebuild preserves T+5 deadline');
      assert.equal(queue[0].seedUsed, 'frozen-seed');
      assert.equal(queue[0].monsterId, 'mon_slime');
      assert.equal(queue[0].log.searchStartAt, new Date(0).toISOString());
    }
    const firstBattleId = queue[0].id;
    now = 5000;
    await integrated.invalidateAndRebuildFutureCombatQueue(character.id);
    assert.equal(queue[0].id, firstBattleId, 'at deadline the frozen battle wins and is never re-simulated');
    now = 6000;
    await integrated.invalidateAndRebuildFutureCombatQueue(character.id);
    assert.equal(queue[0].id, firstBattleId, 'an overdue worker never lets a mutation replace the battle');
    await integrated.encounterClocks.consumeProjection(projection());
    await integrated.encounterClocks.reserveProjection(projection({ sequenceIndex: 7, startAt: new Date(10000), seedUsed: 'later-cycle' }));
    queue.splice(0);
    now = 8000;
    await integrated.queueBattlesLocked(character.id, 2, false);
    assert.deepEqual(queue.map(entry => entry.sequenceIndex), [7, 8], 'later reserved encounters retain monotonic projected sequence');
    assert.deepEqual(character.gatheringCycle, { progress: 0, lastUpdatedAt: new Date(0).toISOString() }, 'projection churn cannot accrue extra gathering time');
  } finally { Date.now = originalNow; }

  console.log('party-intent-clock: passed 100-edit deadline/seed/roster stability, consume identity, lifecycle generation, transaction reuse and actual invalidation ordering');
})().catch(error => { console.error(error); process.exitCode = 1; });
