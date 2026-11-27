const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BattleEngine, simulateBattleV2Solo } = require('../dist');
const monster = require('../../../monsters.json').monsters.find(m => m.id === 'mon_arcanewisp');
const skills = Object.fromEntries(require('../../../skill_trees.json').monsterSkills.map(s => [s.id, s]));
const statuses = Object.fromEntries(require('../../../status_effects.json').statusEffects.map(s => [s.id, s]));
const hero = { characterId: 'probe', level: 45, hp: 100000, maxHp: 100000, sp: 100, maxSp: 100, atk: 1, matk: 0, def: 1000, mdefPercent: 100, accuracy: 1000, evasion: 0, critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5, attackSpeed: 800, moveSpeed: 100, luk: 5, basicAttackRange: 7 };
const page = { lines: [{ priority: 1, conditions: [{ id: 'foe_has_status', params: { status: 'magic_reflection' } }], action: { id: 'attack' } }] };
const options = { monsterSkillDefs: skills, statusEffectDefs: statuses };

test('Wisp opens with Reflection, then casts Surge, and respects its 30-second cooldown at zero SP', () => {
  const result = simulateBattleV2Solo(hero, monster, page, 'wisp-opening', { ...options, stopAfterTick: 130 });
  const uses = result.log.events.filter(e => e.actor === 'monster' && e.action === 'use_skill');
  assert.equal(uses[0]?.skillId, 'monster_skill_magic_reflection');
  assert.equal(uses[0]?.tick, 0, 'opening reflection requires no approach or cast delay');
  assert.equal(uses[0]?.spRemaining.monster, 60, 'reflection leaves all SP available for Surge');
  assert.equal(uses[1]?.skillId, 'monster_skill_arcane_surge');
  const reflects = uses.filter(e => e.skillId === 'monster_skill_magic_reflection');
  assert.deepEqual(reflects.map(e => e.tick), [0, 61, 122], 'normal cooldown blocks the next 60 half-second ticks');
  assert(result.log.events.some(e => e.actor === 'character' && e.action === 'attack'), 'foe Magic Reflection Gambit detects the opening buff');
  const gap = simulateBattleV2Solo(hero, monster, page, 'wisp-opening', { ...options, stopAfterTick: 40 });
  assert(!gap.checkpoint.monsterStatusEffects.some(s => s.type === 'magic_reflection'), '15-second expiration does not bypass the 30-second cooldown');
});

test('Silence delays the active opening skill until it expires', () => {
  const silenced = { ...monster, statusEffects: [{ type: 'silence', appliedAtTick: 0, expiresAtTick: 10 }] };
  const input = simulateBattleV2Solo(hero, monster, page, 'wisp-silenced', { ...options, stopAfterTick: 0 }).v2Input;
  input.actors.find(a => a.kind === 'monster').snapshot.statusEffects = silenced.statusEffects;
  const result = simulateBattleV2Solo(hero, monster, page, 'wisp-silenced', { ...options, persistedInput: input, stopAfterTick: 15 });
  const first = result.log.events.find(e => e.actor === 'monster' && e.action === 'use_skill');
  assert.equal(first?.skillId, 'monster_skill_magic_reflection');
  assert.equal(first?.tick, 10);
});

test('legacy battles also apply Reflection to the Wisp without damaging the player', () => {
  const result = BattleEngine.simulateBattle(hero, monster, page, 'wisp-legacy-opening', { ...options, stopAfterTick: 2 });
  const first = result.log.events.find(e => e.actor === 'monster' && e.action === 'use_skill');
  assert.equal(first?.skillId, 'monster_skill_magic_reflection');
  assert.equal(first?.target, 'monster');
  assert.equal(first?.tick, 0);
  assert(result.checkpoint.monsterStatusEffects.some(s => s.type === 'magic_reflection'));
  assert.equal(result.hpAfter, hero.hp);
});

test('persisted battles with the old passive definition retain their original resource reaction', () => {
  const oldSkills = { ...skills, monster_skill_magic_reflection: { ...skills.monster_skill_magic_reflection, kind: 'passive' } };
  const oldMonster = { ...monster, gambit: monster.gambit.filter(line => line.action.skillId !== 'monster_skill_magic_reflection') };
  const result = simulateBattleV2Solo(hero, oldMonster, page, 'old-wisp-replay', { ...options, monsterSkillDefs: oldSkills, stopAfterTick: 40 });
  const surge = result.log.events.find(e => e.actor === 'monster' && e.action === 'use_skill' && e.skillId === 'monster_skill_arcane_surge');
  const reflection = result.log.events.find(e => e.status === 'magic_reflection' && e.action === 'status_apply');
  assert(surge, 'the old input starts with Surge');
  assert(reflection && reflection.tick > surge.tick, 'old persisted definitions retain reflection after SP exhaustion');
});
