const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');

const root = path.resolve(__dirname, '../../..');
const monsters = JSON.parse(fs.readFileSync(path.join(root, 'monsters.json'), 'utf8')).monsters;
const monsterSkillDefs = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8')).monsterSkills.map(s => [s.id, s]));
const statusEffectDefs = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'status_effects.json'), 'utf8')).statusEffects.map(s => [s.id, s]));

// Hybrid DEF curve: flat protection matters early; the relative component scales
// mitigation with hit size; a 1% raw-damage floor prevents full negation.
assert.equal(BattleEngine.calculatePhysicalDamage(44, 0), 44);
assert(Math.abs(BattleEngine.calculatePhysicalDamage(44, 10) - (44 - 10 * 0.225 - 44 * 10 / 260)) < 1e-9);
assert(Math.abs(BattleEngine.calculatePhysicalDamage(44, 54) - (44 - 54 * 0.225 - 44 * 54 / 304)) < 1e-9);
assert(BattleEngine.calculatePhysicalDamage(44, 64) < BattleEngine.calculatePhysicalDamage(44, 54), 'War Cry +10 DEF should visibly reduce the incoming hit');
assert.equal(BattleEngine.calculatePhysicalDamage(44, 10000), 0.44, 'physical hits retain a 1% floor at extreme armor');
assert(BattleEngine.calculatePhysicalDamage(1000, 54) < 1000 * 0.9, 'the relative component is meaningful against large hits');

function char(overrides = {}) {
  return {
    characterName: 'CastRegression', level: 1, hp: 10000, maxHp: 10000, sp: 1000, maxSp: 1000,
    atk: 20, matk: 1, def: 0, mdefPercent: 0, accuracy: 1000, evasion: 0, critChance: 0,
    agi: 5, dex: 5, luk: 5, attackSpeed: 800, castTimeReduction: 10,
    hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0,
    combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
    statusEffects: [], skills: {}, skillDefs: {}, masteryEquipment: [],
    ...overrides,
  };
}
function simulate(character, monster, page, seed) {
  return BattleEngine.simulateBattle(character, monster, page, seed, { monsterSkillDefs, statusEffectDefs, itemDefinitions: {} });
}

// Dire Wolf begins a four-tick Enraged Strike cast when its Gambit condition
// becomes true; neither a new basic attack nor an instant skill resolution may
// occur during those four ticks.
const wolf = { ...monsters.find(m => m.id === 'mon_direwolf'), hp: 100, atk: 0, maxSp: 60, gambit: [
  { priority: 1, condition: { type: 'self_hp_below_percent', value: 30 }, action: { type: 'use_skill', skillId: 'monster_skill_massive_damage' } },
  { priority: 2, condition: { type: 'always' }, action: { type: 'attack' } },
] };
const castResult = simulate(char(), wolf, { lines: [
  { priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } },
] }, 'dire-wolf-four-tick-cast');
const attacksThatTrigger = castResult.log.events.filter(e => e.actor === 'character' && e.action === 'attack' && e.hpRemaining.monster < 30);
const castEvent = castResult.log.events.find(e => e.actor === 'monster' && e.action === 'use_skill' && e.skillId === 'monster_skill_massive_damage');
assert(attacksThatTrigger.length, 'a character attack should bring the test wolf below 30% HP');
assert(castEvent, 'Dire Wolf must resolve Enraged Strike');
const castStartTick = attacksThatTrigger[0].tick;
assert.equal(castEvent.tick, castStartTick + 4, 'Enraged Strike resolves exactly four ticks after the triggering tick');
assert(!castResult.log.events.some(e => e.actor === 'monster' && e.action === 'attack' && e.tick >= castStartTick && e.tick < castEvent.tick), 'monster basic attacks are paused while the skill cast is pending');
assert(!castResult.log.events.some(e => e.action === 'action_suppressed'), 'stun/disarm suppression is no longer emitted as a combat log event');

// Shield Bash is a passive event sourced by the shield skill, not an action or
// extra character intent. Seed search finds the deterministic 10% proc.
let procEvent = null;
for (let i = 0; i < 150 && !procEvent; i++) {
  const bashCharacter = char({
    hp: 5000, maxHp: 5000, atk: 1,
    masteryEquipment: [{ slot: 'mainHand', category: 'sword' }, { slot: 'offHand', category: 'shield' }],
    skills: {}, skillDefs: { shield_bash: { id: 'shield_bash', masteryRank: 5 } },
  });
  const attacker = { ...monsters.find(m => m.id === 'mon_direwolf'), hp: 1000, atk: 10, accuracy: 1000, critChance: 0, atkSpeedTicks: 2,
    gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }] };
  const result = simulate(bashCharacter, attacker, { lines: [] }, 'shield-bash-passive-' + i);
  procEvent = result.log.events.find(e => e.action === 'status_applied' && e.status === 'stun' && e.sourceSkillId === 'shield_bash');
}
assert(procEvent, 'Shield Bash proc should occur in the deterministic seed search');
assert.equal(procEvent.actor, 'character', 'event source stays attributable to the character without becoming an action');
assert.equal(procEvent.target, 'monster');
assert.equal(procEvent.passiveProc, true, 'Shield Bash stun carries explicit passive-proc metadata');

console.log('defense-monster-casting-passive-logs: passed');
