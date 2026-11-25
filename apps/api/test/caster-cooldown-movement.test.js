const assert = require('node:assert/strict');
const { replayBattleV2 } = require('../../../packages/shared/dist');
const fireBall = require('../../../skill_trees.json').trees.staff.find(skill => skill.id === 'fire_ball');
const stats = {
  level: 33, hp: 390, maxHp: 390, sp: 1000, maxSp: 1000,
  atk: 10, matk: 20, def: 0, mdefPercent: 0, accuracy: 100, evasion: 0, critChance: 0,
  hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5,
  attackSpeed: 400, moveSpeed: 200, basicAttackRange: 0,
};
function battle(extraLines = [], skill = fireBall) {
  return {
    version: 2, tickDurationMs: 500, seed: 'caster-cooldown-movement', definitions: {},
    actors: [
      { id: 'mage', kind: 'character', team: 'a', position: { row: 5, column: 0 },
        snapshot: { ...stats, skills: { [skill.id]: true }, skillDefs: { [skill.id]: skill } },
        inventory: {}, gambits: { lines: [
          { priority: 1, conditions: [{ id: 'foe_nearest' }], action: { id: 'use_skill', skillId: skill.id } },
          ...extraLines,
        ] } },
      { id: 'monster', kind: 'monster', team: 'b', position: { row: 5, column: 9 },
        snapshot: { ...stats, hp: 10000, maxHp: 10000, moveSpeed: 0 }, inventory: {}, gambits: { lines: [] } },
    ],
  };
}
const mageEvents = result => result.events.filter(event => event.actorId === 'mage');
const onlySpells = mageEvents(replayBattleV2(battle(), 21));
assert(onlySpells.filter(event => event.action === 'use_skill').length >= 2, 'fixture must exercise multiple casts and cooldown gaps');
assert.deepEqual(onlySpells.filter(event => event.action === 'move'), [], 'a spell-only mage must wait in place during cooldown');
assert(!onlySpells.some(event => event.action === 'attack'));

const disabledAttack = { priority: 2, enabled: false, conditions: [{ id: 'always' }], action: { id: 'attack' } };
assert(!mageEvents(replayBattleV2(battle([disabledAttack]), 21)).some(event => event.action === 'move'), 'disabled attacks cannot authorize movement');
const conditionalAttack = { priority: 2, conditions: [{ id: 'self_hp', params: { comparator: 'lt', unit: 'percent', value: 20 } }], action: { id: 'attack' } };
assert(!mageEvents(replayBattleV2(battle([conditionalAttack]), 21)).some(event => event.action === 'move'), 'an unmatched attack condition cannot authorize movement');

const attack = { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' } };
const withAttack = mageEvents(replayBattleV2(battle([attack]), 8));
assert(withAttack.some(event => event.action === 'move'), 'a valid melee attack still approaches during the skill cooldown');
const shortRange = mageEvents(replayBattleV2(battle([], { ...fireBall, maxRange: 3 }), 2));
assert(shortRange.some(event => event.action === 'move'), 'an out-of-range spell still approaches without an attack gambit');
assert(!shortRange.some(event => event.action === 'cast_start'), 'movement must bring the spell into range before casting');

const ranged = battle([attack]);
ranged.actors[0].snapshot.basicAttackRange = 8;
ranged.actors[0].snapshot.basicAttackDamageType = 'ranged';
assert(!mageEvents(replayBattleV2(ranged, 21)).some(event => event.action === 'move'), 'a ranged attack already in range must not approach');
console.log('caster-cooldown-movement: spell-only/disabled/conditional idle, valid melee approach, spell range and ranged attack passed');
