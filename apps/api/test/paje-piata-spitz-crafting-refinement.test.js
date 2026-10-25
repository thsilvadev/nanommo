const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveGlobalItemDrops, resolveRefinementFailure, rollEquipmentInstance, rngForIndex, effectiveItemDefinition } = require('@nanommo/shared');

const root = path.resolve(__dirname, '../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const items = read('items.json');
const maps = read('maps.json');
const monsters = read('monsters.json');
const npcs = read('npc_catalog.json');
const quests = read('quests.json');
const allItems = Object.values(items).flatMap(group => Array.isArray(group) ? group : []);
const item = id => allItems.find(row => row.id === id);
const npc = id => npcs.npcs.find(row => row.id === id);
const map = id => maps.maps.find(row => row.id === id);
const quest = id => quests.quests.find(row => row.id === id);

function run() {
  assert(map('map_kwaioua_taba').npcIds.includes('paje_piata'));
  assert(map('map_emperial_capital_caelum').npcIds.includes('whitesmith_spitz'));
  assert.strictEqual(npc('paje_piata').vendor.sellStock.find(x => x.itemId === 'elixir_greater').price, 1200);
  const william = read('npc_vendor.json').sellStock;
  const pajeStock = npc('paje_piata').vendor.sellStock.filter(x => x.itemId !== 'elixir_greater');
  assert.deepStrictEqual(pajeStock, william.filter(x => x.itemId !== 'elixir_greater'));
  for (const id of ['equip_rune_t1', 'equip_head_phys_t1', 'equip_head_magic_t1']) {
    assert(npc('whitesmith_spitz').vendor.sellStock.some(x => x.itemId === id), 'Spitz stock missing ' + id);
  }

  const alchemy = read('alchemy_recipes.json').recipes.find(x => x.id === 'greater_elixir');
  assert.strictEqual(alchemy.requiredLevel, 1);
  assert.deepStrictEqual(alchemy.ingredients, [{ itemId: 'mat_herbs', quantity: 5 }]);
  assert.strictEqual(alchemy.outputItemId, 'elixir_greater');
  const smith = read('blacksmith_recipes.json').recipes;
  assert.deepStrictEqual(smith.find(x => x.id === 'bronze_ingot').ingredients, [{ itemId: 'mat_bronze_ore', quantity: 10 }]);
  for (const id of ['equip_head_phys_t2','equip_head_magic_t2','equip_cape_phys_t2','equip_cape_magic_t2','equip_body_phys_t2','equip_body_magic_t2','equip_shoes_traveler_t1','equip_sword_t2','equip_greatsword_t2','equip_dagger_t2','equip_bow_t2','equip_staff_t2','equip_rod_t2','equip_shield_t2','equip_rune_t2']) {
    assert(smith.some(x => x.outputItemId === id), 'Blacksmith recipe missing ' + id);
  }

  const tear = item('part_flamingtreant_common');
  assert.strictEqual(tear.name, "Forest Ancient's Teardrop");
  assert.strictEqual(tear.questOnly, true);
  assert.deepStrictEqual(tear.usableFor, ['quest_turn_in']);
  const forestQuest = quest('forest_ancient_teardrop');
  assert.strictEqual(forestQuest.minLevel, 35);
  assert.strictEqual(forestQuest.objectives[0].chancePercent, 35);
  assert.strictEqual(forestQuest.objectives[0].quantity, 5);
  assert.strictEqual(forestQuest.rewards.characterXp, 31630);
  assert.deepStrictEqual(forestQuest.rewards.items, [{ itemId: 'equip_shoes_earth_t2', quantity: 1, disableRandomRoll: true }]);
  const treant = monsters.monsters.find(x => x.id === 'mon_flamingtreant');
  assert(treant.drops.some(x => x.itemId === 'part_flamingtreant_bark' && x.chance === 0.35));
  assert(!treant.drops.some(x => x.itemId === 'part_flamingtreant_common'));
  assert(item('part_flamingtreant_bark'));

  const shifted = [
    ['equip_shoes_earth_t2', 2, 8], ['equip_shoes_water_t2', 2, 8],
    ['equip_shoes_fire_t3', 3, 15], ['equip_shoes_shadow_t3', 3, 15],
    ['equip_shoes_wind_t4', 4, 22], ['equip_shoes_holy_t4', 4, 22],
  ];
  for (const [id, tier, level] of shifted) {
    assert.strictEqual(item(id).tier, tier);
    assert.strictEqual(item(id).levelReq, level);
    assert.strictEqual(item(id).randomRollOnDrop.enabled, false);
    assert.strictEqual(item(id).randomRollOnCraft.enabled, true);
  }
  assert.deepStrictEqual(item('equip_shoes_traveler_t1').fixedStats, { def: 1, moveSpeed: 10 });
  assert.strictEqual(item('equip_shoes_traveler_t1').randomRollOnCraft.enabled, true);

  for (const id of ['map_wastelands_0', 'map_wastelands_1', 'map_menace_hills_2']) {
    assert.deepStrictEqual(map(id).gatheringPool, [{ itemId: 'mat_bronze_ore', weight: 100 }]);
  }

  // The new dropped statsPool/rolls path coexists with legacy dropped attribute pools.
  const headgear = item('equip_head_phys_t1');
  const statRoll = rollEquipmentInstance(headgear, rngForIndex('refinement-test-head', 0));
  assert(['hp','sp','evasion','defense'].includes(statRoll.rolledStat));
  assert(statRoll.rolledStatValue >= headgear.randomRollOnDrop.rolls[statRoll.rolledStat].min);
  assert(statRoll.rolledStatValue <= headgear.randomRollOnDrop.rolls[statRoll.rolledStat].max);
  const shieldRoll = rollEquipmentInstance(item('equip_shield_t1'), rngForIndex('refinement-test-shield', 0));
  assert(['STR','AGI','DEX','VIT','INT','LUK'].includes(shieldRoll.rolledAttribute));
  assert(!Object.prototype.hasOwnProperty.call(shieldRoll, 'rolledStat'));

  // Refinement modifies only the supported direct stats on a fresh definition and never mutates the catalogue.
  const sourceDefinition = item('equip_sword_t1');
  const refinedDefinition = effectiveItemDefinition(sourceDefinition, { refinementLevel: 2 });
  assert.strictEqual(refinedDefinition.fixedStats.atk, Number(sourceDefinition.fixedStats.atk) + 6);
  assert.strictEqual(sourceDefinition.fixedStats.atk, 8);
  // Every failure boundary matches the contract, including optional-shard protection.
  for (const level of [3,4,5]) assert.deepStrictEqual(resolveRefinementFailure(level, false), {destroyed:false,nextLevel:level});
  for (const level of [6,7,8]) {
    assert.deepStrictEqual(resolveRefinementFailure(level, false), {destroyed:false,nextLevel:0});
    assert.deepStrictEqual(resolveRefinementFailure(level, true), {destroyed:false,nextLevel:level});
  }
  for (const level of [9,10,11]) {
    assert.deepStrictEqual(resolveRefinementFailure(level, false), {destroyed:true,nextLevel:level});
    assert.deepStrictEqual(resolveRefinementFailure(level, true), {destroyed:false,nextLevel:level-1});
  }

  const rules = read('global_item_drops.json').drops;
  const chance = (rule, level) => Math.min(rule.maxChancePercent, rule.baseChancePercent + Math.max(0, level - rule.baseMonsterLevel) * rule.perLevelIncreasePercent);
  assert.deepStrictEqual(rules.map(x => chance(x, 1)), [0.501, 0.0501]);
  assert.deepStrictEqual(rules.map(x => Number(chance(x, 99).toFixed(4))), [0.599, 0.0599]);
  assert.deepStrictEqual(rules.map(x => Number(chance(x, 100).toFixed(4))), [0.6, 0.06]);
  const monster = { id: 'mon_flamingtreant', level: 100 };
  const firstRolls = resolveGlobalItemDrops(monster, rules, 123);
  assert.deepStrictEqual(resolveGlobalItemDrops(monster, rules, 123), firstRolls);
  const extended = resolveGlobalItemDrops(monster, [...rules, { itemId: 'test_unrelated_global_item', baseChancePercent: 0.5, perLevelIncreasePercent: 0, maxChancePercent: 0.5 }], 123);
  assert.deepStrictEqual(extended.filter(x => rules.some(r => r.itemId === x.itemId)), firstRolls);

  for (const file of ['items.json','maps.json','monsters.json','npc_catalog.json','quests.json','alchemy_recipes.json','blacksmith_recipes.json','global_item_drops.json']) {
    assert.deepStrictEqual(read(file), read('apps/frontend/public/data/' + file), file + ' frontend mirror is stale');
  }
  console.log('Pajé/Spitz, professions, Forest Ancient quest, boot tiers, global-drop formulas and mirrors: OK');
}
run();
