const assert = require('node:assert/strict');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');

(async () => {
  const character = {
    id: 'char-1', status: 'town', currentMapId: 'map_town', hpCurrent: 824, spCurrent: 50,
  };
  const battle = {
    id: 'battle-stale', characterId: 'char-1', mapId: 'map_lv_1',
    sequenceIndex: 0, resolved: false, hpAfter: 152, spAfter: 20,
  };
  let deleted = false;
  let publishedQueue = false;
  const service = Object.create(BattleService.prototype);
  service.logger = { log() {}, warn() {}, error() {}, debug() {} };
  service.withCharacterQueueLock = async (_characterId, operation) => operation();
  service.getBattleQueue = async () => [];
  service.buildAuthoritativeBattleSnapshot = async () => ({ character });
  service.safePublishQueueUpdated = async () => { publishedQueue = true; };
  service.battleQueueRepo = {
    findOne: async () => battle,
    manager: {
      transaction: async callback => callback({
        getRepository(entity) {
          if (entity?.name === 'Character') return { findOne: async () => character };
          if (entity?.name === 'BattleQueueEntry') return {
            findOne: async () => battle,
            delete: async () => { deleted = true; return { affected: 1 }; },
          };
          throw new Error(`Unexpected repository ${entity?.name}`);
        },
      }),
    },
  };

  const resolved = await service.resolveBattle('battle-stale');
  assert.equal(resolved, false, 'stale battle must not be treated as a resolved combat');
  assert.equal(deleted, true, 'stale unresolved row must be removed transactionally');
  assert.equal(character.hpCurrent, 824, 'stale battle must not restore its old HP snapshot');
  assert.equal(character.spCurrent, 50, 'stale battle must not restore its old SP snapshot');
  assert.equal(publishedQueue, true, 'client queue must be refreshed after stale row removal');
  console.log('Stale battle map guard prevents old HP/SP snapshots from overwriting Town resources.');
})().catch(error => { console.error(error); process.exit(1); });
