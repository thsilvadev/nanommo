// Heavy Swing hits every foe in the 8 cells around the caster (full damage), never allies, Disarm only on
// its target; extra hits are `splash` events (not another use_skill for mastery or cooldowns).
// Run: pnpm --filter @nanommo/shared build && node apps/api/test/heavy-swing-area.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const shared = require(path.join(root, 'packages/shared/dist'));
const trees = require(path.join(root, 'skill_trees.json'));
const statuses = Object.fromEntries(require(path.join(root, 'status_effects.json')).statusEffects.map((s) => [s.id, s]));
const monsters = require(path.join(root, 'monsters.json'));
const slime = (Array.isArray(monsters) ? monsters : (monsters.monsters ?? Object.values(monsters).flat())).find((m) => m.id === 'mon_slime');

const heavySwing = { ...Object.values(trees.trees).flat().find((s) => s.id === 'heavy_swing'), masteryRank: 1 };
assert.equal(heavySwing.effect.areaRadius, 1, 'catalogue: Heavy Swing reaches the cells around the caster');
const stats = (extra) => ({ level: 30, hp: 5000, maxHp: 5000, sp: 500, maxSp: 500, atk: 200, matk: 0, def: 0, mdefPercent: 0, accuracy: 999, evasion: 0, critChance: 0,
  hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 1, dex: 200, attackSpeed: 1, moveSpeed: 0, canMove: false, ...extra });
const monster = (id, row, column) => ({ id, kind: 'monster', team: 'b', position: { row, column }, definitionId: 'mon_slime', name: id,
  snapshot: { ...shared.BattleEngine.buildMonsterSnapshot(slime), hp: 50_000, maxHp: 50_000, def: 0, moveSpeed: 0, canMove: false }, gambits: [], inventory: {}, attackIntervalTicks: 9999 });
const input = {
  version: 2, elementalRulesVersion: 1, movementRulesVersion: 1, seed: 'heavy-swing-area', tickDurationMs: 500, maxTicks: 40,
  definitions: { statuses },
  actors: [
    { id: 'hero', kind: 'character', team: 'a', position: { row: 5, column: 4 }, name: 'Hero', snapshot: stats({ skillDefs: { heavy_swing: heavySwing }, skills: { heavy_swing: heavySwing } }),
      gambits: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId: 'heavy_swing' } } }], inventory: {} },
    { id: 'ally', kind: 'character', team: 'a', position: { row: 4, column: 4 }, name: 'Ally', snapshot: stats({}), gambits: [], inventory: {} },
    monster('m-a', 5, 5), monster('m-b', 6, 5), monster('m-far', 5, 7),
  ],
};
const result = shared.simulateBattleV2(input);
const swing = result.events.find((e) => e.action === 'use_skill' && e.actorId === 'hero' && e.payload.skillId === 'heavy_swing');
assert(swing, 'Heavy Swing resolved');
const main = swing.targetIds[0];
const splashes = result.events.filter((e) => e.action === 'splash' && e.tick === swing.tick);
const other = main === 'm-a' ? 'm-b' : 'm-a';
assert.deepEqual(splashes.map((e) => e.targetIds[0]), [other], 'the other adjacent foe (diagonal included) is hit, the far one is not');
assert.equal(splashes[0].actorId, 'hero');
assert.equal(splashes[0].payload.skillId, 'heavy_swing');
assert(splashes[0].payload.damage > 0, 'full damage on the splash target');
const hpAfter = (id) => swing.actorStates && result.events.filter((e) => e.tick === swing.tick).pop().actorStates[id].hp;
assert(hpAfter(other) < 50_000, 'splash target lost HP');
assert.equal(hpAfter('m-far'), 50_000, 'far foe untouched');
assert.equal(hpAfter('ally'), 5000, 'ally never hit');
// Damage is the same formula: with no defense and no variance difference beyond the roll, both hits are of the same size.
assert(Math.abs(splashes[0].payload.damage - swing.payload.damage) <= Math.ceil(swing.payload.damage * 0.25), `full damage (${splashes[0].payload.damage} vs ${swing.payload.damage})`);
const disarms = result.events.filter((e) => e.action === 'status_apply' && e.payload.statusId === 'disarm' && e.tick === swing.tick);
assert.deepEqual(disarms.map((e) => e.targetIds[0]), [main], 'Disarm only on the target');
// Mastery and cooldowns see one swing.
assert.equal(result.events.filter((e) => e.action === 'use_skill' && e.tick === swing.tick && e.actorId === 'hero').length, 1);
console.log(`heavy-swing-area: ${main} hit, ${other} splashed, m-far and ally untouched, Disarm on ${main} only`);
