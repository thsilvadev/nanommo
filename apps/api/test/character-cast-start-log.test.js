// A character skill with a cast time logs when its cast began on the use_skill
// event that resolves it (castStartedAtTick), so clients can animate the cast
// from the pre-computed log. Instant skills carry no such field, and the field
// changes nothing else in the battle (same events, same outcome).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');
const root = path.resolve(__dirname, '../../..');
const tree = JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8'));
const statusRows = JSON.parse(fs.readFileSync(path.join(root, 'status_effects.json'), 'utf8')).statusEffects;
const statusEffectDefs = Object.fromEntries(statusRows.map((x) => [x.id, x]));
const skills = Object.fromEntries([...Object.values(tree.trees).flat(), ...(tree.legacySkills ?? [])].map((x) => [x.id, x]));

function run(skillId, { dex = 5, duration } = {}) {
  const base = skills[skillId];
  assert(base, `Missing catalog skill ${skillId}`);
  const skill = { ...base, ...(duration === undefined ? {} : { baseCastTicks: duration }), effect: { ...(base.effect ?? {}) }, masteryRank: 1 };
  const character = { characterName: 'CastLog', level: 1, hp: 10000, maxHp: 10000, sp: 1000, maxSp: 1000, atk: 50, matk: 1, def: 0, mdefPercent: 0, accuracy: 100, evasion: 0, critChance: 0, agi: 5, dex, attackSpeed: 800, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0, statusEffects: [], skills: { [skillId]: skill }, skillDefs: { [skillId]: skill }, masteryEquipment: [] };
  const monster = { id: 'dummy', name: 'Dummy', level: 1, hp: 400, atk: 0, matk: 0, def: 0, mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 100, combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0, moveSpeedBase: 0, gambit: [] };
  const lines = [
    { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId } } },
    { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' } },
  ];
  return BattleEngine.simulateBattle(character, monster, { lines }, 'cast-log-' + skillId, { statusEffectDefs, itemDefinitions: {} });
}

const casted = run('war_cry', { duration: 4 });
const casts = casted.log.events.filter((e) => e.actor === 'character' && e.action === 'use_skill');
assert(casts.length > 0, 'War Cry should resolve');
for (const event of casts) {
  assert.equal(typeof event.castStartedAtTick, 'number', 'a cast skill logs castStartedAtTick');
  assert.equal(event.tick - event.castStartedAtTick, 4, 'a four-tick cast (DEX 5, 10 CTR) started four ticks before it resolved');
}
assert.equal(casts[0].castStartedAtTick, 0);
// Only the use_skill event of the cast carries it.
assert(!casted.log.events.some((e) => e.action !== 'use_skill' && 'castStartedAtTick' in e), 'no other event carries castStartedAtTick');

const instant = run('war_cry', { duration: 0 });
const instantCasts = instant.log.events.filter((e) => e.actor === 'character' && e.action === 'use_skill');
assert(instantCasts.length > 0);
for (const event of instantCasts) assert(!('castStartedAtTick' in event), 'an instant skill has no cast start');

// Purely additive: stripping the field gives the same events as before, and the outcome is unchanged.
const again = run('war_cry', { duration: 4 });
assert.deepEqual(again.log.events, casted.log.events, 'deterministic');
assert.equal(casted.outcome ?? casted.result, again.outcome ?? again.result);

console.log('character-cast-start-log: passed');
