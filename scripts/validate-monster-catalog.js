const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const maps = read('maps.json').maps;
const monsters = read('monsters.json').monsters;
const items = read('items.json');
const skills = read('skill_trees.json');
for (const name of ['items.json','monsters.json','skill_trees.json','status_effects.json','maps.json']) {
  assert.deepEqual(read(name), read('apps/frontend/public/data/' + name), `${name} root/frontend catalogue parity`);
}
assert.equal(maps.length, 41, 'Definitive world contains 41 locations');
assert.equal(maps.filter(map => map.type === 'town').length, 5, 'Five canonical Towns');
assert.equal(maps.filter(map => map.type === 'grind').length, 36, 'Thirty-six canonical grind maps');
assert.equal(maps.find(map => map.id === 'map_town')?.type, 'town');
assert.deepEqual(maps.find(map => map.id === 'map_town')?.coordinates, {x:0,y:0});
assert.ok(maps.every(map => map.isClickable === true), 'All canonical locations are clickable');
assert.equal(new Set(maps.map(map => `${map.coordinates.x},${map.coordinates.y}`)).size, maps.length, 'Map coordinates unique');
const gatheringAllowList = new Map([
  ['map_green_grounds_0', ['mat_wheat','mat_milk']], ['map_green_grounds_1', ['mat_cabbage','mat_carrot','mat_honeycomb']],
  ['map_green_grounds_2', ['mat_cabbage','mat_carrot']], ['map_green_grounds_3', ['mat_wheat']], ['map_green_grounds_4', ['mat_sugar','mat_honeycomb']], ['map_green_grounds_5', ['mat_sugar']],
  ['map_menace_hills_1', ['mat_wild_blueberries']], ['map_menace_hills_3', ['mat_wild_blueberries']],
  ['map_ipora_beach_0', ['mat_cooking_oil']], ['map_ipora_beach_1', ['mat_cooking_oil']],
]);
for (const map of maps) if (/^map_kwaioua_forest_[0-7]$/.test(map.id) || /^map_forest_ruins_[0-3]$/.test(map.id) || /^map_caete_[0-7]$/.test(map.id)) gatheringAllowList.set(map.id, ['mat_herbs']);
for (const map of maps) {
  assert.ok(Number.isFinite(map.mapLength), `${map.id} mapLength exists`);
  assert.equal(map.mapLength, map.type === 'town' ? 0 : 25, `${map.id} mapLength matches type`);
  assert.ok(Array.isArray(map.monsters), `${map.id} has a roster array`);
  if (map.type === 'town') {
    assert.equal(map.gatheringPool, undefined, `${map.id} Town has no gathering pool`);
    continue;
  }
  assert.ok(map.monsters.length, `${map.name} has a monster roster`);
  assert.ok(Math.abs(map.monsters.reduce((sum, entry) => sum + Number(entry.presenceRate), 0) - 100) < 0.02, `${map.name} monster weights sum to 100`);
  assert.ok(Number(map.monsters_quantity) >= 1, `${map.name} has at least one monster slot`);
  const allowed = gatheringAllowList.get(map.id) || [];
  if (allowed.length) assert.ok(Array.isArray(map.gatheringPool) && map.gatheringPool.length > 0, `${map.id} has its assigned gathering pool`);
  else assert.equal(map.gatheringPool, undefined, `${map.id} has no regional assignment and omits gatheringPool`);
  if (map.gatheringPool !== undefined) {
    assert.ok(Array.isArray(map.gatheringPool), `${map.id} gathering pool is an array`);
    assert.ok(Math.abs(map.gatheringPool.reduce((sum, entry) => sum + Number(entry.weight), 0) - 100) < 0.001, `${map.id} gathering weights sum to 100`);
    assert.ok(map.gatheringPool.every(entry => items.materials.some(item => item.id === entry.itemId && item.type === 'material')), `${map.id} only references materials`);
    assert.ok(map.gatheringPool.every(entry => gatheringAllowList.get(map.id)?.includes(entry.itemId)), `${map.id} obeys its exact regional allow-list`);
    assert.ok(map.gatheringPool.every(entry => Number.isFinite(Number(entry.weight)) && Number(entry.weight) >= 0), `${map.id} gathering weights are non-negative`);
    assert.ok(!map.gatheringPool.some(entry => entry.itemId === 'mat_meat'), `${map.id} never gathers Meat`);
  }
}
// Reachability on the canonical four-way grid; tie-breaking by map ID is shared with the runtime BFS.
const mapById = new Map(maps.map(map => [map.id, map]));
for (const destination of maps) {
  const seen = new Set(['map_town']); const queue = [mapById.get('map_town')];
  while (queue.length) {
    const current = queue.shift();
    const neighbors = maps.filter(map => map.isClickable !== false)
      .filter(map => Math.abs(map.coordinates.x-current.coordinates.x)+Math.abs(map.coordinates.y-current.coordinates.y)===1)
      .sort((a,b)=>a.id.localeCompare(b.id));
    for (const next of neighbors) if (!seen.has(next.id)) {seen.add(next.id);queue.push(next);}
  }
  assert.ok(seen.has(destination.id), `${destination.id} is reachable from Sierra Village`);
}
const byId = new Map(monsters.map(monster => [monster.id, monster]));
assert.equal(byId.size, monsters.length, 'Monster IDs unique');
const peaceful = new Set(['mon_slime','mon_thornsprout','mon_saltfangcrab','mon_moonleafarcanist','mon_giantmantis']);
for (const monster of monsters) {
  assert.equal(typeof monster.isAggressive, 'boolean', `${monster.id} explicit aggression`);
  assert.equal(monster.isAggressive, !peaceful.has(monster.id), `${monster.id} aggression matches approved initial set`);
  assert.ok(Number.isFinite(monster.moveSpd) && monster.moveSpd >= 0, `${monster.id} world moveSpd valid`);
  assert.equal(monster.moveSpd, Math.max(0, Math.floor(Number(monster.moveSpeedBase ?? 0))) + Number(monster.level ?? 1) - 1, `${monster.id} shared Move Speed equals species base + level - 1`);
  assert.ok(Number.isFinite(monster.xpReward) && monster.xpReward > 0, `${monster.name} xpReward`);
  for (const drop of monster.drops || []) {
    assert.ok([...items.monsterParts,...items.consumables,...items.equipment,...items.materials].some(item=>item.id===drop.itemId) || ['item_consumable_random_map_tier','equip_green_grounds_roll','equip_menace_roll','equip_ruins_roll'].includes(drop.itemId), `${monster.name} missing drop ${drop.itemId}`);
  }
}
assert.deepEqual(monsters.filter(monster => (monster.drops || []).some(drop => drop.itemId === 'mat_meat' && Number(drop.chance) === 0.2)).map(monster => monster.id).sort(), ['mon_direwolf','mon_needlebackstalker']);
const gatheredMaterialIds = new Set(maps.flatMap(map => (map.gatheringPool ?? []).map(entry => entry.itemId)));
assert.deepEqual(gatheredMaterialIds, new Set(items.materials.map(item => item.id).filter(id => id !== 'mat_meat')), 'all nine gatherable materials are distributed world-wide; Meat is excluded');
assert.equal(maps.filter(map => map.type === 'grind' && Array.isArray(map.gatheringPool)).length, gatheringAllowList.size, 'only assigned regional maps have a gathering pool');
assert.equal(items.materials.length, 10, 'Ten stable cooking/material IDs');
assert.equal(new Set(items.materials.map(item=>item.id)).size, items.materials.length, 'Material IDs unique');
for (const item of items.materials) {
  assert.equal(item.type, 'material', `${item.id} has material type`);
  assert.ok(item.stackable && Number(item.maxStack) > 0 && Number.isFinite(Number(item.sellPriceToVendor)), `${item.id} has stack/sale metadata`);
  for (const variant of ['svg','svg-noframe']) assert.ok(fs.existsSync(path.join('apps/frontend/assets/ui/items', variant, 'materials', item.id + '.svg')), `${item.id} ${variant} icon exists`);
}
assert.equal(items.consumables.find(item=>item.id==='food_blueberry')?.name, 'Blueberry Jelly');
assert.equal(items.consumables.find(item=>item.id==='food_honey')?.name, 'Honey');
for (const variant of ['svg','svg-noframe']) assert.ok(fs.existsSync(path.join('apps/frontend/assets/ui/items', variant, 'consumables', 'food_blueberry.svg')), `Blueberry Jelly ${variant} icon exists`);
for (const item of items.monsterParts) {
  if (item.id.startsWith('part_mudflatcrocodile_') || item.id.startsWith('part_bandit_') || item.id.startsWith('part_kwaioua_ranger_') || item.id.startsWith('part_sacredforestguardian_') || item.id.startsWith('part_gravelhorn_') || item.id.startsWith('part_ridgebreaker_') || item.id.startsWith('part_saltfangcrab_') || item.id.startsWith('part_needlebackstalker_') || item.id.startsWith('part_giantmosquito_') || item.id.startsWith('part_rootboundbrute_') || item.id.startsWith('part_moonleafarcanist_') || item.id.startsWith('part_aramaianwarden_')) {
    assert.ok(item.rarity && item.droppedBy?.length && item.stackable === true && item.maxStack && item.sellPriceToVendor, `Invalid monster part schema ${item.id}`);
  }
}
const thorn = byId.get('mon_thornsprout'); assert.equal(thorn.canMove, false); assert.equal(thorn.elementalDamageTakenMultiplier.fire, 2);
for (const id of ['fire_ball','fire_blast']) assert.equal(skills.trees.staff.find(skill=>skill.id===id).element, 'fire');
for (const id of ['wisp_flow','light_of_heaven']) assert.equal(skills.trees.rod.find(skill=>skill.id===id).element, 'light');
assert.ok(monsters.some(monster=>monster.id==='mon_bandit' && monster.level===25));
assert.ok(monsters.some(monster=>monster.id==='mon_mudflatcrocodile' && monster.level===12));
assert.ok(monsters.some(monster=>monster.id==='mon_kwaiouaranger' && monster.level===33));
assert.ok(monsters.some(monster=>monster.id==='mon_sacredforestguardian' && monster.level===50));
console.log(`Validated ${maps.length} locations, ${monsters.length} monsters, ${items.monsterParts.length} monster parts, ${items.materials.length} materials and ${maps.filter(map=>map.gatheringPool).length} gathering pools across assigned Grind maps.`);
