// Use item (Self / Ally / Foe): the condition scope picks who the item is used on.
const assert = require('node:assert/strict');
const path = require('node:path');
const s = require('../../../packages/shared/dist');
const { GambitService } = require('../dist/apps/api/src/modules/gambit/gambit.service');

const root = path.join(__dirname, '../../..');
const itemsJson = require(path.join(root, 'items.json'));
const catalogItems = Object.values(itemsJson).filter(Array.isArray).flat();
const item = (id) => catalogItems.find((i) => i.id === id);

// --- shared rules -------------------------------------------------------------
const ko = (scope) => ({ id: `${scope}_has_status`, params: { status: 'ko' } });
const cond = (id, params = {}) => ({ id, params });
const err = s.itemTargetError;
assert.deepEqual(s.itemTargetsForScope('self'), ['self']);
assert.deepEqual(s.itemTargetsForScope('ally'), ['ally', 'self']);
assert.deepEqual(s.itemTargetsForScope('foe'), ['foe', 'self']);
assert.equal(err('self', cond('foe_has_status', { status: 'magic_prowess' }), item('tonic_haste_shot')), null, 'Foe condition, item on self');
assert.equal(err('foe', cond('foe_has_status', { status: 'magic_prowess' }), item('tonic_haste_shot')), null, 'Foe condition, item on the foe');
assert.equal(err('ally', cond('ally_hp', { comparator: 'lt', unit: 'percent', value: 50 }), item('mega_elixir')), null);
assert.equal(err('self', cond('ally_hp', { comparator: 'lt', unit: 'percent', value: 50 }), item('mega_elixir')), null);
assert.ok(err('foe', cond('self_hp', {}), item('mega_elixir')), 'no foe target on a Self condition');
assert.ok(err('ally', cond('foe_hp', {}), item('mega_elixir')), 'no ally target on a Foe condition');
assert.ok(err('foe', cond('ally_hp', {}), item('mega_elixir')), 'no foe target on an Ally condition');
assert.equal(err('self', ko('self'), item('fairy_in_a_bottle')), null, 'Fairy: Self KO');
assert.ok(err('self', cond('self_hp', {}), item('fairy_in_a_bottle')), 'Fairy only on Self KO');
assert.ok(err('self', ko('self'), item('mega_elixir')), 'Self KO only Fairy');
assert.equal(err('ally', ko('ally'), item('super_tonic_sapupema_tea')), null, 'Sapupema: Ally KO on the ally');
assert.ok(err('self', ko('ally'), item('super_tonic_sapupema_tea')), 'Sapupema never on self');
assert.ok(err('ally', cond('ally_hp', {}), item('super_tonic_sapupema_tea')), 'Sapupema only on Ally KO');
assert.ok(err('foe', cond('foe_hp', {}), item('super_tonic_sapupema_tea')), 'Sapupema never on a foe');
assert.ok(err('ally', ko('ally'), item('mega_elixir')), 'a KO ally only takes a revive item');
assert.equal(err('self', ko('ally'), item('tonic_haste_shot')), null, 'an ally falls → I drink a tonic');
assert.ok(err('foe', cond('foe_hp', {}), { type: 'food', effect: { type: 'food_buff' } }), 'no food on a foe');
assert.equal(s.legacyItemTarget(['ally_hp'], 'heal_hp'), 'ally');
assert.equal(s.legacyItemTarget(['foe_has_status'], 'apply_status'), 'self', 'legacy: Foe condition used the item on self');

// --- engine -------------------------------------------------------------------
const stats = { level: 1, hp: 100, sp: 50, maxHp: 100, maxSp: 50, atk: 0, matk: 0, def: 0, mdefPercent: 0, accuracy: 100, evasion: 0, critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 50, attackSpeed: 800, moveSpeed: 0 };
const definitions = { items: Object.fromEntries(['tonic_haste_shot', 'mega_elixir', 'super_tonic_sapupema_tea', 'fairy_in_a_bottle'].map((id) => [id, item(id)])) };
const prowess = [{ type: 'magic_prowess', appliedAtTick: 0, expiresAtTick: 1000 }];
function battle(line, { self = {}, ally = null, foe = {} } = {}) {
  const actors = [
    { id: 'a', kind: 'character', team: 'a', position: { row: 5, column: 2 }, snapshot: { ...stats, ...self }, gambits: { lines: [{ priority: 1, enabled: true, ...line }] }, inventory: { tonic_haste_shot: 5, mega_elixir: 5, super_tonic_sapupema_tea: 2, fairy_in_a_bottle: 1 } },
    { id: 'b', kind: 'monster', team: 'b', position: { row: 5, column: 7 }, snapshot: { ...stats, hp: 1000, maxHp: 1000, ...foe }, gambits: { lines: [] }, inventory: {} },
  ];
  if (ally) actors.push({ id: 'c', kind: 'character', team: 'a', position: { row: 6, column: 2 }, snapshot: { ...stats, ...ally }, gambits: { lines: [] }, inventory: {} });
  return s.simulateBattleV2({ version: 2, tickDurationMs: 500, seed: 'item-target', definitions, actors, maxTicks: 60 });
}
const uses = (result) => result.events.filter((e) => e.actorId === 'a' && e.action === 'use_item');
const targetOf = (e) => e.targetIds?.[0] ?? e.targets?.[0] ?? e.targetId;
const has = (result, id, status) => result.events.some((e) => e.actorStates?.[id]?.statusEffects?.some((x) => (x.type ?? x.id) === status));

// Foe: Status = Magic Prowess → Use item (Foe): Haste Shot lands on the foe.
const onFoe = battle({ conditions: [cond('foe_has_status', { status: 'magic_prowess' })], action: { id: 'use_item', params: { itemId: 'tonic_haste_shot', target: 'foe' } } }, { foe: { statusEffects: prowess } });
assert.ok(uses(onFoe).length >= 1, 'item thrown');
assert.equal(targetOf(uses(onFoe)[0]), 'b');
assert.ok(has(onFoe, 'b', 'haste_shot') && !has(onFoe, 'a', 'haste_shot'), 'the foe got the tonic');
// ... → Use item (Self): on me.
const onSelf = battle({ conditions: [cond('foe_has_status', { status: 'magic_prowess' })], action: { id: 'use_item', params: { itemId: 'tonic_haste_shot', target: 'self' } } }, { foe: { statusEffects: prowess } });
assert.equal(targetOf(uses(onSelf)[0]), 'a');
assert.ok(has(onSelf, 'a', 'haste_shot') && !has(onSelf, 'b', 'haste_shot'));
// A page saved before `target` keeps the old behaviour (self).
const legacy = battle({ conditions: [cond('foe_has_status', { status: 'magic_prowess' })], action: { id: 'use_item', params: { itemId: 'tonic_haste_shot' } } }, { foe: { statusEffects: prowess } });
assert.equal(targetOf(uses(legacy)[0]), 'a');
// The condition still gates it: no Magic Prowess, no throw.
assert.equal(uses(battle({ conditions: [cond('foe_has_status', { status: 'magic_prowess' })], action: { id: 'use_item', params: { itemId: 'tonic_haste_shot', target: 'foe' } } })).length, 0);
// A potion thrown at a foe heals the foe.
const healFoe = battle({ conditions: [cond('foe_hp', { comparator: 'lt', unit: 'percent', value: 90 })], action: { id: 'use_item', params: { itemId: 'mega_elixir', target: 'foe' } } }, { foe: { hp: 500 } });
assert.equal(targetOf(uses(healFoe)[0]), 'b');
assert.ok(Number(uses(healFoe)[0].payload.healAmount) > 0, 'the foe was healed');
// Ally condition: on the ally that met it, or on me.
const allyLine = (target) => ({ conditions: [cond('ally_hp', { comparator: 'lt', unit: 'percent', value: 50 })], action: { id: 'use_item', params: { itemId: 'mega_elixir', target } } });
assert.equal(targetOf(uses(battle(allyLine('ally'), { ally: { hp: 20 } }))[0]), 'c');
assert.equal(targetOf(uses(battle(allyLine('self'), { self: { hp: 60 }, ally: { hp: 20 } }))[0]), 'a');
// Rule breakers are skipped by the engine even if a page holds them.
assert.equal(uses(battle({ conditions: [cond('self_hp', { comparator: 'gt', unit: 'value', value: 0 })], action: { id: 'use_item', params: { itemId: 'mega_elixir', target: 'foe' } } })).length, 0, 'Self condition cannot throw at a foe');
assert.equal(uses(battle({ conditions: [ko('ally')], action: { id: 'use_item', params: { itemId: 'super_tonic_sapupema_tea', target: 'self' } } }, { ally: { hp: 0 } })).length, 0, 'Sapupema not on self');
assert.equal(uses(battle({ conditions: [cond('foe_hp', { comparator: 'gt', unit: 'value', value: 0 })], action: { id: 'use_item', params: { itemId: 'mega_elixir', target: 'nowhere' } } })).length, 0, 'unknown target');

// --- server validation ----------------------------------------------------------
(async () => {
  const gambitCatalog = require(path.join(root, 'gambit_catalog.json'));
  const svc = Object.create(GambitService.prototype);
  svc.dataService = { getGambitCatalog: () => gambitCatalog, getSkillTrees: () => ({ trees: {} }), getItemById: item, getItems: () => catalogItems };
  const check = async (condition, params) => (await svc.validateGambitLine({ priority: 1, conditions: [condition], action: { id: 'use_item', params } }, 'l')).errors.map((e) => e.message);
  assert.deepEqual(await check(cond('foe_has_status', { status: 'magic_prowess' }), { itemId: 'tonic_haste_shot', target: 'foe' }), []);
  assert.deepEqual(await check(cond('foe_has_status', { status: 'magic_prowess' }), { itemId: 'tonic_haste_shot', target: 'self' }), []);
  assert.deepEqual(await check(cond('foe_has_status', { status: 'magic_prowess' }), { itemId: 'tonic_haste_shot' }), [], 'legacy line still saves');
  assert.deepEqual(await check(ko('ally'), { itemId: 'super_tonic_sapupema_tea', target: 'ally' }), []);
  assert.deepEqual(await check(ko('self'), { itemId: 'fairy_in_a_bottle', target: 'self' }), []);
  assert.ok((await check(ko('ally'), { itemId: 'super_tonic_sapupema_tea', target: 'self' })).length);
  assert.ok((await check(cond('ally_hp', { comparator: 'lt', unit: 'percent', value: 30 }), { itemId: 'super_tonic_sapupema_tea', target: 'ally' })).length, 'Sapupema only on Ally KO');
  assert.ok((await check(cond('self_hp', { comparator: 'lt', unit: 'percent', value: 30 }), { itemId: 'mega_elixir', target: 'foe' })).length);
  assert.ok((await check(cond('self_hp', { comparator: 'lt', unit: 'percent', value: 30 }), { itemId: 'mega_elixir', target: 'moon' })).length);
  assert.equal((await check(ko('self'), { itemId: 'mega_elixir', target: 'self' })).length, 1, 'one message for Self KO with another item');
  console.log('gambit-item-target passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
