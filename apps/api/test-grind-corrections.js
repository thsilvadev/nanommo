const assert = require('node:assert/strict');
const { applyLevelXpResolution } = require('./dist/apps/api/src/modules/battle/battle.service');
const shared = require('../../packages/shared/dist/battle-engine/index.js');
const rewards = require('../../packages/shared/dist/battle-engine/rewards.js');

const xp = applyLevelXpResolution(16, 1, 40, (level) => ({ 1: 17, 2: 30, 3: 45 }[level] ?? 999));
assert.equal(xp.level, 3);
assert.equal(xp.levelsGained, 2);
assert.equal(xp.xp, 9);

assert.equal(rewards.resolveXpGain({ xpReward: 18 }, 'win'), 4);
assert.equal(rewards.resolveGoldGain({ goldReward: { min: 100, max: 100 } }, new shared.Mulberry32('gold-test')), 0);

const character = {
  level: 1, hp: 50, sp: 0, maxHp: 100, maxSp: 10, atk: 1, matk: 1, def: 0, mdefPercent: 0,
  accuracy: 100, evasion: 0, critChance: 0, hpRegenPerTenTicks: 5, spRegenPerTenTicks: 0,
  agi: 100, dex: 100, skills: {}, skillDefs: {}, statusEffects: [],
};
const monster = {
  id: 'test_monster', level: 1, hp: 9999, atk: 1, matk: 1, def: 0, mdefPercent: 0,
  accuracy: 0, evasion: 100, critChance: 0, atkSpeedTicks: 100, gambit: [{ condition: { type: 'always' }, action: { type: 'attack' } }],
};
const regen = shared.BattleEngine.simulateBattle(character, monster, null, 'regen-test', {
  maxTicks: 6, regenTickOffset: 15, weaponBaseAttackTicks: 100,
});
const regenEvents = regen.log.events.filter((e) => e.action === 'regen');
assert.equal(regenEvents.length, 1);
assert.equal(regenEvents[0].tick, 4);
assert.equal(regenEvents[0].amount, 5);
assert.equal(regen.hpAfter, 55);

const critCharacter = { ...character, hp: 100, atk: 10, agi: 100, critChance: 100 };
const critMonster = { ...monster, hp: 20, evasion: 0, accuracy: 0 };
const critPage = { lines: [{ priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } }] };
const crit = shared.BattleEngine.simulateBattle(critCharacter, critMonster, critPage, 'crit-test', { maxTicks: 2, regenTickOffset: 0, weaponBaseAttackTicks: 1 });
assert.ok(crit.log.events.some((e) => e.action === 'attack' && e.actor === 'character' && e.crit === true));

console.log('grind corrections pure checks: PASS');
