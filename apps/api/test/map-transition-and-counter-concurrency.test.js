const assert = require('node:assert/strict');
const { MapService } = require('../dist/apps/api/src/modules/map/map.service.js');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity.js');
const { User } = require('../dist/apps/api/src/database/entities/user.entity.js');
const { BattleQueueEntry } = require('../dist/apps/api/src/database/entities/battle-queue-entry.entity.js');
const { BadRequestException } = require('@nestjs/common');

const maps = [
  { id: 'map_town', type: 'town', isClickable: true, coordinates: { x: 0, y: 0 } },
  { id: 'map_a', type: 'grind', isClickable: true, coordinates: { x: -1, y: 0 } },
  { id: 'map_b', type: 'grind', isClickable: true, coordinates: { x: -2, y: 0 } },
  { id: 'map_c', type: 'grind', isClickable: true, coordinates: { x: -1, y: 1 } },
];

function mapHarness(initialCharacter, initialRows = []) {
  const character = { ...initialCharacter };
  const rows = [...initialRows];
  const presenceCalls = [];
  const resetCalls = [];
  const cancelledAfter = [];
  const removedJobs = [];
  const calls = { cancelAll: 0, queued: 0 };
  const characterRepo = {
    manager: {
      transaction: async callback => callback({
        getRepository(entity) {
          if (entity === Character) return {
            findOne: async () => character,
            save: async row => { Object.assign(character, row); return row; },
          };
          if (entity === User) return { findOne: async () => ({ id: 'user-1', emailVerified: true }) };
          if (entity === BattleQueueEntry) return {
            find: async () => rows.filter(row => !row.resolved).sort((a, b) => a.sequenceIndex - b.sequenceIndex),
            delete: async criteria => {
              const rawIds = criteria?.id?._value;
              const ids = Array.isArray(rawIds) ? rawIds : [criteria?.id];
              for (let i = rows.length - 1; i >= 0; i--) {
                if (ids.includes(rows[i].id) && !rows[i].resolved) rows.splice(i, 1);
              }
              return { affected: ids.length };
            },
          };
          throw new Error('Unexpected repository ' + String(entity?.name));
        },
      }),
    },
  };
  const service = Object.create(MapService.prototype);
  service.characterRepo = characterRepo;
  service.userRepo = { findOne: async () => ({ emailVerified: true }) };
  service.dataService = { getMapById: id => maps.find(map => map.id === id) };
  service.logger = { warn() {}, debug() {}, log() {}, error() {} };
  service.mapPresenceService = { syncCharacter: async (id, previousMapId) => presenceCalls.push({ id, previousMapId }) };
  service.battleService = {
    withCharacterQueueLock: async (_id, operation) => operation(),
    cancelPendingBattlesAfter: async (_id, battleId) => { cancelledAfter.push(battleId); },
    cancelPendingBattles: async () => { calls.cancelAll++; rows.splice(0, rows.length); },
    removeBattleQueueJobs: async ids => removedJobs.push(...ids),
    resetEncounterSequence: async (id, mapId, reason, manager) => resetCalls.push({ id, mapId, reason, manager }),
    queueBattles: async id => { calls.queued++; assert.equal(id, character.id); },
  };
  return { service, character, rows, presenceCalls, resetCalls, cancelledAfter, removedJobs, calls };
}

(async () => {
  {
    const now = Date.now();
    const h = mapHarness({
      id: 'char-1', userId: 'user-1', currentMapId: 'map_a', status: 'grinding',
      discoveredMapIds: ['map_town', 'map_a', 'map_b', 'map_c'], pendingMapTransition: null,
      activeFoodBuff: { expiresAt: new Date(now + 3600000).toISOString() }, savedTownMapId: null,
    }, [
      { id: 'battle-active', sequenceIndex: 0, resolved: false, startAt: new Date(now - 20000), endAt: new Date(now - 1000), mapId: 'map_a' },
      { id: 'battle-future', sequenceIndex: 1, resolved: false, startAt: new Date(now + 30000), endAt: new Date(now + 40000), mapId: 'map_a' },
    ]);
    const first = await h.service.enterMap('char-1', 'map_b', new Date(now - 1000).toISOString());
    assert.equal(first.deferred, true, 'an unresolved battle which passed endAt must still hold the transition');
    assert.equal(h.character.currentMapId, 'map_a', 'the source map remains authoritative during the battle');
    assert.equal(h.character.pendingMapTransition.destinationMapId, 'map_b');
    assert.equal(h.character.pendingMapTransition.reason, 'map_request');
    assert.deepEqual(h.rows.map(row => row.id), ['battle-active'], 'future old-map encounters are discarded');
    assert.deepEqual(h.removedJobs, ['battle-future'], 'only the stale future Bull job is removed after its row was deleted transactionally');
    assert(h.presenceCalls.some(call => call.previousMapId === 'map_a'), 'origin presence is synced as soon as movement is pending');

    const second = await h.service.enterMap('char-1', 'map_c', new Date(now + 1000).toISOString());
    assert.equal(second.deferred, true);
    assert.equal(h.character.pendingMapTransition.destinationMapId, 'map_c', 'a second click replaces the pending destination');
    const stale = await h.service.enterMap('char-1', 'map_b', new Date(now).toISOString());
    assert.equal(stale.superseded, true, 'an older delayed HTTP request cannot overwrite the latest click');
    assert.equal(h.character.pendingMapTransition.destinationMapId, 'map_c');

    h.rows.splice(0, h.rows.length); // the battle is now confirmed resolved
    const immediate = await h.service.enterMap('char-1', 'map_b', new Date(now + 2000).toISOString());
    assert.equal(immediate.deferred, false);
    assert.equal(h.character.currentMapId, 'map_b');
    assert.equal(h.character.pendingMapTransition, null);
    assert(h.resetCalls.some(call => call.mapId === 'map_a' && call.reason === 'left map'), 'leaving any Grind map resets its encounter epoch');
    assert.equal(h.calls.queued, 1, 'only the final committed destination is queue-filled');
    console.log('map transition: deferred until unresolved battle commits, latest destination wins, future queue trimmed and source epoch reset');
  }

  {
    const h = mapHarness({ id: 'char-2', userId: 'user-1', currentMapId: 'map_town', status: 'town', pendingMapTransition: null, savedTownMapId: null });
    const saved = await h.service.saveCurrentTown('char-2');
    assert.deepEqual(saved, { savedTownMapId: 'map_town' });
    assert.equal(h.character.savedTownMapId, 'map_town');
    h.character.pendingMapTransition = { destinationMapId: 'map_b', reason: 'map_request' };
    await assert.rejects(() => h.service.saveCurrentTown('char-2'), error => error instanceof BadRequestException);
    console.log('saved Town waypoint: only a settled Town can be saved; persisted location returned');
  }

  {
    const rows = new Map();
    let insertCount = 0;
    const key = (characterId, mapId) => `${characterId}/${mapId}`;
    const repo = {
      async findOne({ where }) {
        const snapshot = rows.get(key(where.characterId, where.mapId)) ?? null;
        await new Promise(resolve => setTimeout(resolve, 10));
        return snapshot ? { ...snapshot } : null;
      },
      createQueryBuilder() {
        let values;
        const builder = {
          insert() { return builder; }, into() { return builder; },
          values(value) { values = value; return builder; },
          orIgnore() { return builder; },
          async execute() {
            const k = key(values.characterId, values.mapId);
            if (!rows.has(k)) {
              insertCount++;
              rows.set(k, { id: 'counter-one', ...values });
            }
            return { raw: [] };
          },
        };
        return builder;
      },
    };
    const service = Object.create(BattleService.prototype);
    service.mapKillCounterRepo = repo;
    const [a, b] = await Promise.all([
      service.getOrCreateKillCounter('char-3', 'map_b'),
      service.getOrCreateKillCounter('char-3', 'map_b'),
    ]);
    assert.equal(insertCount, 1, 'ON CONFLICT DO NOTHING allows only one physical counter row');
    assert.equal(a.id, b.id);
    console.log('map kill counter: concurrent first access is idempotent and does not violate the unique constraint');
  }

  {
    const locks = new Map();
    const redis = {
      async set(key, token, _px, _ttl, nx) {
        if (nx === 'NX' && locks.has(key)) return null;
        locks.set(key, token); return 'OK';
      },
      async eval(script, _n, key, token) {
        if (locks.get(key) !== token) return 0;
        if (script.includes('pexpire')) return 1;
        locks.delete(key); return 1;
      },
    };
    const service = Object.create(BattleService.prototype);
    service.redis = redis; service.logger = { error() {} };
    let active = 0; let maxActive = 0; let completed = 0;
    const work = () => service.withCharacterQueueLock('same-character', async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 90));
      active--; completed++;
    });
    await Promise.all([work(), work()]);
    assert.equal(completed, 2);
    assert.equal(maxActive, 1, 'the distributed character lock serializes queue/transition operations');
    console.log('encounter-chain lock: concurrent operations for the same character are serialized');
  }
  console.log('map-transition-and-counter-concurrency: passed');
})().catch(error => { console.error(error); process.exit(1); });
