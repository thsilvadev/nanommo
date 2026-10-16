const fs = require('node:fs');
const assert = require('node:assert/strict');
const maps = JSON.parse(fs.readFileSync('maps.json', 'utf8')).maps;
const monsters = JSON.parse(fs.readFileSync('monsters.json', 'utf8')).monsters;
const items = JSON.parse(fs.readFileSync('items.json', 'utf8'));
const skills = JSON.parse(fs.readFileSync('skill_trees.json', 'utf8'));
for (const name of ['items.json','monsters.json','skill_trees.json','status_effects.json','maps.json']) { assert.deepEqual(JSON.parse(fs.readFileSync(name,'utf8')), JSON.parse(fs.readFileSync('apps/frontend/public/data/'+name,'utf8')), name+' root/frontend catalogue parity'); }
assert.equal(maps.length, 7, 'Town plus six level maps');
assert.deepEqual(maps.map(m => m.coordinates), [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:0,y:4},{x:0,y:5},{x:0,y:6}]);
assert.equal(maps[0].type, 'town'); assert.equal(maps[0].name, 'Town');
assert.equal(maps[0].is_town_border, false); assert.equal(maps[1].is_town_border, true);
assert.ok(maps.every(m => m.isClickable === true));
assert.ok(maps.every(m => m.description === null));
assert.ok(maps.slice(1).every(m => m.type === 'grind' && m.monsters_quantity === 100));
const byId = new Map(monsters.map(m => [m.id, m]));
assert.equal(byId.size, monsters.length, 'Monster IDs unique');
const appearances = new Map();
for (const map of maps.slice(1)) {
 assert.ok(map.monsters.length, `${map.name} has roster`);
 assert.ok(Math.abs(map.monsters.reduce((sum, m) => sum + m.presenceRate, 0) - 100) < 0.02, `${map.name} weights sum to 100`);
 for (const row of map.monsters) {
  assert.ok(byId.has(row.monsterId), `Missing monster ${row.monsterId}`);
  const monster = byId.get(row.monsterId);
  const min = Number(map.name.slice(4));
  const max = min === 1 ? 5 : min + 4;
  assert.ok(monster.level >= min && monster.level <= max, `${monster.name} level ${monster.level} outside ${map.name}`);
  appearances.set(row.monsterId, (appearances.get(row.monsterId) || 0) + 1);
 }
}
for (const monster of monsters.filter(m => m.level <= 30)) assert.equal(appearances.get(monster.id), 1, `${monster.name} must appear in exactly one map`);
for (const monster of monsters) {
 assert.ok(Number.isFinite(monster.xpReward) && monster.xpReward > 0, `${monster.name} xpReward`);
 for (const drop of monster.drops || []) assert.ok([...items.monsterParts,...items.consumables,...items.equipment].some(i=>i.id===drop.itemId) || ['item_consumable_random_map_tier','equip_green_grounds_roll','equip_menace_roll','equip_ruins_roll'].includes(drop.itemId), `${monster.name} missing drop ${drop.itemId}`);
}
for (const item of items.monsterParts) {
 if (item.id.startsWith('part_mudflatcrocodile_') || item.id.startsWith('part_bandit_') || item.id.startsWith('part_kwaioua_ranger_') || item.id.startsWith('part_sacredforestguardian_') || item.id.startsWith('part_gravelhorn_') || item.id.startsWith('part_ridgebreaker_') || item.id.startsWith('part_saltfangcrab_') || item.id.startsWith('part_needlebackstalker_') || item.id.startsWith('part_giantmosquito_') || item.id.startsWith('part_rootboundbrute_') || item.id.startsWith('part_moonleafarcanist_') || item.id.startsWith('part_aramaianwarden_')) {
  assert.ok(item.rarity && item.droppedBy?.length && item.stackable === true && item.maxStack && item.sellPriceToVendor, `Invalid monster part schema ${item.id}`);
 }
}
const thorn = byId.get('mon_thornsprout'); assert.equal(thorn.level, 5); assert.equal(thorn.canMove, false); assert.equal(thorn.elementalDamageTakenMultiplier.fire, 2);
for (const id of ['fire_ball','fire_blast']) assert.equal(skills.trees.staff.find(s=>s.id===id).element, 'fire');
for (const id of ['wisp_flow','light_of_heaven']) assert.equal(skills.trees.rod.find(s=>s.id===id).element, 'light');
assert.ok(monsters.some(m=>m.id==='mon_bandit' && m.level===25));
assert.ok(monsters.some(m=>m.id==='mon_mudflatcrocodile' && m.level===12));
assert.ok(monsters.some(m=>m.id==='mon_kwaiouaranger' && m.level===33));
assert.ok(monsters.some(m=>m.id==='mon_sacredforestguardian' && m.level===50));
console.log(`Validated ${maps.length} maps, ${monsters.length} monsters, and ${items.monsterParts.length} monster-part items.`);
