#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const maps = read('maps.json').maps;
const species = new Set(read('monsters.json').monsters.map(row => row.id));
const catalogue = read('items.json');
const items = new Map(Object.values(catalogue).flatMap(rows => Array.isArray(rows) ? rows : []).map(row => [row.id, row]));
let entries = 0;
for (const map of maps) for (const entry of map.monsters) {
  entries++;
  assert.ok(species.has(entry.monsterId), `${map.id}: missing principal ${entry.monsterId}`);
  assert.ok(Array.isArray(entry.raid?.candidates), `${map.id}/${entry.monsterId}: raid.candidates is required`);
  const seen = new Set();
  let total = 0;
  for (const candidate of entry.raid.candidates) {
    assert.ok(species.has(candidate.monsterId), `${map.id}: missing raid species ${candidate.monsterId}`);
    assert.ok(!seen.has(candidate.monsterId), `${map.id}: duplicate raid candidate ${candidate.monsterId}`);
    seen.add(candidate.monsterId);
    assert.ok(typeof candidate.chance === 'number' && Number.isFinite(candidate.chance) && candidate.chance >= 0 && candidate.chance <= 100, `${map.id}: invalid raid chance`);
    total += candidate.chance;
  }
  assert.ok(total <= 100, `${map.id}: exclusive raid chances exceed 100`);
}
const seenRecipes = new Set();
for (const recipe of read('alchemy_recipes.json').recipes) {
  assert.ok(!seenRecipes.has(recipe.id), `duplicate recipe ${recipe.id}`);
  seenRecipes.add(recipe.id);
  assert.ok(['potions', 'tonics', 'super_tonics'].includes(recipe.category), `${recipe.id}: invalid Alchemy category`);
  const output = items.get(recipe.outputItemId);
  assert.ok(output?.type === 'consumable' && output.alchemyCategory === recipe.category, `${recipe.id}: output/category mismatch`);
  assert.ok(Number.isInteger(recipe.requiredLevel) && recipe.requiredLevel >= 1, `${recipe.id}: invalid level`);
  assert.ok(Number.isFinite(recipe.xpReward) && recipe.xpReward >= 0, `${recipe.id}: invalid XP`);
  assert.ok(recipe.ingredients.length > 0, `${recipe.id}: missing ingredients`);
  for (const ingredient of recipe.ingredients) assert.ok(items.get(ingredient.itemId)?.type === 'material' && Number.isInteger(ingredient.quantity) && ingredient.quantity > 0, `${recipe.id}: invalid ingredient`);
  if (recipe.category === 'super_tonics') assert.equal(output.cooldownInSeconds, 60, `${recipe.id}: Super Tonics share 60 seconds`);
}
for (const file of ['maps.json', 'alchemy_recipes.json']) assert.deepEqual(read(file), read(`apps/frontend/public/data/${file}`), `${file}: frontend mirror mismatch`);
// Existing unrelated vendor-price differences in the historical items mirror are preserved.
const publicItems = read('apps/frontend/public/data/items.json');
const mirroredItems = new Map(Object.values(publicItems).flatMap(rows => Array.isArray(rows) ? rows : []).map(row => [row.id, row]));
for (const id of ['fairy_in_a_bottle', 'antidote', 'super_tonic_sapupema_tea', 'mat_sapupema_leaf']) assert.deepEqual(mirroredItems.get(id), items.get(id), `${id}: frontend mirror mismatch`);
console.log(`Party catalogue validation passed: ${entries} raid rosters and ${seenRecipes.size} Alchemy recipes; Party feature mirrors synchronized.`);
