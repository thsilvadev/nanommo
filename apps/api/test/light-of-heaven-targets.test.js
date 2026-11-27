// Light of Heaven (rod, Holy): any target picked by the line's condition (Self / Ally / Foe), range 8;
// a Shadow target takes the heal amount as damage instead; the gambit validator accepts every scope.
// Run: pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build && node apps/api/test/light-of-heaven-targets.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const shared = require(path.join(root, 'packages/shared/dist'));
const trees = require(path.join(root, 'skill_trees.json'));
const mirror = require(path.join(root, 'apps/frontend/public/data/skill_trees.json'));
const statuses = Object.fromEntries(require(path.join(root, 'status_effects.json')).statusEffects.map((s) => [s.id, s]));
const monsters = require(path.join(root, 'monsters.json'));
const slime = (Array.isArray(monsters) ? monsters : monsters.monsters).find((m) => m.id === 'mon_slime');

const catalogue = Object.values(trees.trees).flat().find((s) => s.id === 'light_of_heaven');
assert.equal(catalogue.target, 'any');
assert.equal(catalogue.maxRange, 8);
assert.equal(catalogue.ranged, true);
assert.equal(catalogue.element, 'holy');
assert.deepEqual(Object.values(mirror.trees).flat().find((s) => s.id === 'light_of_heaven'), catalogue, 'frontend mirror in sync');

const skill = { ...catalogue, masteryRank: 1, baseCastTicks: 0, cooldownTicks: 0 };
const MATK = 200; // floor(200 / 20) = 10 % of the target's max HP, + 50 at rank 1
const amountFor = (maxHp) => 50 + Math.floor(maxHp * Math.floor(MATK / 20) / 100);
const stats = (extra) => ({ level: 30, hp: 5000, maxHp: 5000, sp: 500, maxSp: 500, atk: 0, matk: MATK, def: 0, mdefPercent: 0, accuracy: 999, evasion: 0, critChance: 0,
  hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 1, dex: 200, attackSpeed: 1, moveSpeed: 0, canMove: false, ...extra });
const caster = (gambits, extra = {}) => ({ id: 'hero', kind: 'character', team: 'a', position: { row: 5, column: 0 }, name: 'Hero',
  snapshot: stats({ skillDefs: { light_of_heaven: skill }, skills: { light_of_heaven: skill }, ...extra }), gambits, inventory: {} });
const foe = (element, column = 1, extra = {}) => ({ id: 'foe', kind: 'monster', team: 'b', position: { row: 5, column }, definitionId: 'mon_slime', name: 'Foe',
  snapshot: { ...shared.BattleEngine.buildMonsterSnapshot(slime), element, hp: 20_000, maxHp: 50_000, def: 0, mdefPercent: 0, moveSpeed: 0, canMove: false, ...extra }, gambits: [], inventory: {}, attackIntervalTicks: 9999 });
const line = (condition) => [{ priority: 1, conditions: [condition], action: { id: 'use_skill', params: { skillId: 'light_of_heaven' } } }];
const run = (actors, maxTicks = 6) => shared.simulateBattleV2({ version: 2, elementalRulesVersion: 1, movementRulesVersion: 1, seed: 'light-of-heaven', tickDurationMs: 500, maxTicks, definitions: { statuses }, actors });
const casts = (result) => result.events.filter((e) => e.action === 'use_skill' && e.actorId === 'hero' && e.payload.skillId === 'light_of_heaven');

// Self: heals the caster.
{
  const result = run([caster(line({ id: 'self_hp', params: { comparator: 'lt', unit: 'percent', value: 100 } }), { hp: 1000 }), foe('neutral')], 1);
  const [cast] = casts(result);
  assert(cast, 'cast on self');
  assert.deepEqual(cast.targetIds, ['hero']);
  assert.equal(cast.payload.healAmount, amountFor(5000));
  assert.equal(cast.payload.damage, 0);
}

// Ally: heals the ally the condition picked, not the caster.
{
  const ally = { id: 'ally', kind: 'character', team: 'a', position: { row: 4, column: 0 }, name: 'Ally', snapshot: stats({ hp: 900, maxHp: 4000 }), gambits: [], inventory: {} };
  const result = run([caster(line({ id: 'ally_hp', params: { comparator: 'lt', unit: 'percent', value: 50 } })), ally, foe('neutral')], 1);
  const [cast] = casts(result);
  assert.deepEqual(cast.targetIds, ['ally']);
  assert.equal(cast.payload.healAmount, amountFor(4000));
}

// Foe with Shadow: the heal amount becomes damage (pure: no mitigation or variance), recorded as damage.
{
  const result = run([caster(line({ id: 'foe_hp', params: { comparator: 'gt', unit: 'percent', value: 0 } })), foe('shadow', 1, { def: 500, mdefPercent: 60 })], 1);
  const [cast] = casts(result);
  assert.deepEqual(cast.targetIds, ['foe']);
  assert.equal(cast.payload.damage, amountFor(50_000));
  assert.equal(cast.payload.damageType, 'pure');
  assert.equal(cast.payload.healAmount, 0);
  assert.equal(cast.actorStates.foe.hp, 20_000 - amountFor(50_000));
}

// Foe that is not Shadow: it is healed.
{
  const result = run([caster(line({ id: 'foe_hp', params: { comparator: 'gt', unit: 'percent', value: 0 } })), foe('neutral')], 1);
  const [cast] = casts(result);
  assert.deepEqual(cast.targetIds, ['foe']);
  assert.equal(cast.payload.damage, 0);
  assert.equal(cast.payload.healAmount, amountFor(50_000));
}

// Range 8: a foe 8 cells away is reached, 9 cells away is not (the caster cannot move here).
{
  const lineFoe = line({ id: 'foe_hp', params: { comparator: 'gt', unit: 'percent', value: 0 } });
  assert.equal(casts(run([caster(lineFoe), foe('shadow', 8)], 1)).length, 1, 'reaches 8 cells');
  assert.equal(casts(run([caster(lineFoe), foe('shadow', 9)], 6)).length, 0, 'not 9 cells');
}

// Server gambit validator: Light of Heaven fits Self, Ally and Foe conditions; another self skill still only Self.
(async () => {
  const { GambitService } = require('../dist/apps/api/src/modules/gambit/gambit.service');
  const svc = Object.create(GambitService.prototype);
  svc.dataService = { getSkillTrees: () => trees, getItemById: () => null, getGambitCatalog: () => require(path.join(root, 'gambit_catalog.json')) };
  const errorsOf = (conditionId, skillId) => {
    const errors = [];
    // Only the skill-target rule is under test: call the line validator and keep its skill-target messages.
    const result = svc.validateGambitLine?.({ priority: 1, conditions: [{ id: conditionId, params: { comparator: 'lt', unit: 'percent', value: 50 } }], action: { id: 'use_skill', params: { skillId } } }, 0);
    return Promise.resolve(result).then((r) => (r?.errors ?? errors).filter((e) => /Skill target/.test(e.message)));
  };
  if (typeof GambitService.prototype.validateGambitLine !== 'function') throw new Error('fixture: GambitService.validateGambitLine not found');
  for (const condition of ['self_hp', 'ally_hp', 'foe_hp']) assert.deepEqual(await errorsOf(condition, 'light_of_heaven'), [], `Light of Heaven allowed for ${condition}`);
  const selfOnly = Object.values(trees.trees).flat().find((s) => s.target === 'self' && s.kind === 'active');
  assert.equal((await errorsOf('foe_hp', selfOnly.id)).length, 1, `${selfOnly.id} (self) still refused for a foe condition`);
  console.log('light-of-heaven-targets: self, ally, foe heal, Shadow burn, range 8 and validator ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
