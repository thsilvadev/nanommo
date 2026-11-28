const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DataService } = require('../dist/apps/api/src/modules/data/data.service');
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const items = read('items.json');
const recipes = read('alchemy_recipes.json').recipes;
const maps = read('maps.json').maps;
const item = id => [...items.consumables, ...items.materials].find(row => row.id === id);
const recipe = id => recipes.find(row => row.id === id);
assert.equal(item('fairy_in_a_bottle').alchemyCategory, 'super_tonics');
assert.equal(item('fairy_in_a_bottle').cooldownInSeconds, 60);
assert.equal(recipe('fairy_in_a_bottle').requiredLevel, 10);
assert.equal(recipe('fairy_in_a_bottle').ingredients.find(row => row.itemId === 'mat_mystic_dust').quantity, 3);
assert.equal(recipe('fairy_in_a_bottle').category, 'super_tonics');
assert.equal(item('super_tonic_sapupema_tea').alchemyCategory, 'super_tonics');
assert.equal(item('super_tonic_sapupema_tea').cooldownInSeconds, 60);
assert.deepEqual(item('super_tonic_sapupema_tea').effect, { type: 'revive_ally', hpPercent: 50, spPercent: 50 });
assert.deepEqual(recipe('sapupema_tea').ingredients, [{ itemId: 'mat_herbs', quantity: 8 }, { itemId: 'mat_sapupema_leaf', quantity: 3 }, { itemId: 'part_unicorn_common', quantity: 1 }]);
assert.equal(recipe('sapupema_tea').requiredLevel, 7);
assert.equal(recipe('sapupema_tea').xpReward, 90);
assert.equal(item('antidote').alchemyCategory, 'potions');
assert.deepEqual(item('antidote').effect, { type: 'cure_status', status: 'poison' });
assert.equal(recipe('antidote').requiredLevel, 1);
assert.deepEqual(recipe('antidote').ingredients, [{ itemId: 'mat_herbs', quantity: 2 }, {itemId:'part_venomviper_common',quantity:1}]);
const pool = maps.find(row => row.id === 'map_caete_6').gatheringPool;
assert.equal(pool.find(row => row.itemId === 'mat_sapupema_leaf').weight, 60);
assert.equal(pool.find(row => row.itemId === 'mat_herbs').weight, 40);
assert.ok(!pool.some(row => row.itemId === 'mat_mystic_dust'));
for (const name of ['maps.json', 'alchemy_recipes.json']) assert.deepEqual(read(`apps/frontend/public/data/${name}`), read(name), `${name} frontend mirror`);
// The baseline frontend items mirror has unrelated historical vendor-price differences.
const mirroredItems = read('apps/frontend/public/data/items.json');
for (const id of ['fairy_in_a_bottle', 'antidote', 'super_tonic_sapupema_tea', 'mat_sapupema_leaf']) assert.deepEqual([...mirroredItems.consumables, ...mirroredItems.materials].find(row => row.id === id), item(id), `${id} frontend mirror`);
for (const id of ['mat_sapupema_leaf', 'super_tonic_sapupema_tea']) {
  const folder = id.startsWith('mat_') ? 'materials' : 'consumables';
  for (const variant of ['svg', 'svg-noframe']) assert.ok(fs.existsSync(`apps/frontend/assets/ui/items/${variant}/${folder}/${id}.svg`));
  for (const locale of ['en-US', 'pt-BR']) assert.ok(item(id).locales[locale].name);
}
function service(mutate = () => {}) {
  const svc = Object.create(DataService.prototype);
  const fields = { items: 'items', monsters: 'monsters', maps: 'maps', skillTrees: 'skill_trees', statusEffects: 'status_effects', gambitCatalog: 'gambit_catalog', npcVendor: 'npc_vendor', npcCatalog: 'npc_catalog', cookingRecipes: 'cooking_recipes', alchemyRecipes: 'alchemy_recipes', blacksmithRecipes: 'blacksmith_recipes', globalItemDrops: 'global_item_drops', quests: 'quests', appearanceCatalog: 'appearance_catalog' };
  for (const [field, file] of Object.entries(fields)) svc[field] = read(`${file}.json`);
  mutate(svc);
  return svc;
}
assert.doesNotThrow(() => service().validateCatalogues());
const firstRoster = svc => svc.maps.maps.find(row => row.monsters.length).monsters[0];
for (const map of maps) for (const entry of map.monsters) {
  assert.ok(entry.raid.candidates.length > 0, `${map.id}/${entry.monsterId} has candidate data`);
  assert.ok(entry.raid.candidates.every(row => row.chance === 0), 'initial raid rates disabled');
}
for (const chance of [-1, 101, NaN, '10']) assert.throws(() => service(svc => firstRoster(svc).raid = { candidates: [{ monsterId: 'mon_slime', chance }] }).validateCatalogues(), /raid.*chance/i);
assert.throws(() => service(svc => firstRoster(svc).raid = { candidates: [{ monsterId: 'missing', chance: 0 }] }).validateCatalogues(), /raid.*missing/i);
assert.throws(() => service(svc => firstRoster(svc).raid = { candidates: [{ monsterId: 'mon_slime', chance: 70 }, { monsterId: 'mon_fieldbat', chance: 31 }] }).validateCatalogues(), /raid.*100/i);
assert.throws(() => service(svc => firstRoster(svc).raid = { candidates: [{ monsterId: 'mon_slime', chance: 0 }, { monsterId: 'mon_slime', chance: 0 }] }).validateCatalogues(), /raid.*duplicate/i);
assert.throws(() => service(svc => delete firstRoster(svc).raid).validateCatalogues(), /raid.*candidates/i);
assert.throws(() => service(svc => svc.alchemyRecipes.recipes.find(row => row.id === 'sapupema_tea').category = 'invalid').validateCatalogues(), /Alchemy.*category/i);
assert.throws(() => service(svc => svc.items.consumables.find(row => row.id === 'super_tonic_sapupema_tea').cooldownInSeconds = 30).validateCatalogues(), /Super tonic.*60/i);
console.log('party-alchemy-catalog: passed raid integrity, resources, Super Tonics, preserved Fairy recipe, Antidote, mirrors and assets');
