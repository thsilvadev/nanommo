const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = JSON.parse(fs.readFileSync(path.join(__dirname, '../maps.json'), 'utf8')).maps;
const frontPath = path.join(__dirname, '../apps/frontend/public/data/maps.json');
assert.deepEqual(JSON.parse(fs.readFileSync(frontPath, 'utf8')).maps, root, 'frontend map catalogue mirrors canonical root');
const monsters = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../monsters.json'), 'utf8')).monsters.map(m => m.id));
assert.equal(root.length, 41, 'exactly 41 locations');
assert.equal(new Set(root.map(m => m.id)).size, 41, 'unique IDs');
assert.equal(new Set(root.map(m => `${m.coordinates.x},${m.coordinates.y}`)).size, 41, 'unique coordinates');
assert.equal(root.filter(m => m.type === 'town').length, 5, 'five Towns');
assert.equal(root.filter(m => m.type === 'grind').length, 36, '36 grind maps');
const gatherableByMap = new Map([
  ['map_green_grounds_0', ['mat_wheat','mat_milk']], ['map_green_grounds_1', ['mat_cabbage','mat_carrot','mat_honeycomb']],
  ['map_green_grounds_2', ['mat_cabbage','mat_carrot']], ['map_green_grounds_3', ['mat_wheat']], ['map_green_grounds_4', ['mat_sugar','mat_honeycomb']], ['map_green_grounds_5', ['mat_sugar']],
  ['map_menace_hills_1', ['mat_wild_blueberries']], ['map_menace_hills_3', ['mat_wild_blueberries']],
  ['map_ipora_beach_0', ['mat_cooking_oil']], ['map_ipora_beach_1', ['mat_cooking_oil']],
]);
for (const m of root) if (/^map_kwaioua_forest_[0-7]$/.test(m.id) || /^map_forest_ruins_[0-3]$/.test(m.id) || /^map_caete_[0-7]$/.test(m.id)) gatherableByMap.set(m.id, ['mat_herbs']);
assert.equal(root.filter(m => m.type === 'grind' && Array.isArray(m.gatheringPool) && m.gatheringPool.length).length, gatherableByMap.size, 'only explicitly assigned Grind maps have pools');
for (const m of root) {
  assert.equal(Number.isInteger(m.coordinates.x) && Number.isInteger(m.coordinates.y), true, `${m.id} integer coordinates`);
  assert.ok(m.coordinates.x + 8 >= 1 && m.coordinates.x + 8 <= 15 && 7 - m.coordinates.y >= 1 && 7 - m.coordinates.y <= 13, `${m.id} within 15x13 grid`);
  assert.equal(m.isClickable, true, `${m.id} clickable`);
  assert.equal(m.unlockLevel, 0, `${m.id} has no level gate`);
  if (m.type === 'town') { assert.deepEqual(m.monsters, [], `${m.id} peaceful`); assert.ok(m.npcIds.includes('storage'), `${m.id} has Storage`); assert.equal(m.gatheringPool, undefined, `${m.id} Town has no gathering pool`); }
  else {
    assert.ok(m.monsters.length, `${m.id} roster exists`);
    assert.ok(Math.abs(m.monsters.reduce((s, e) => s + e.presenceRate, 0) - 100) < .02, `${m.id} weights total 100`);
    const allowed = gatherableByMap.get(m.id);
    if (!allowed) assert.equal(m.gatheringPool, undefined, `${m.id} has no gathering pool without an assignment`);
    else {
      assert.ok(Array.isArray(m.gatheringPool) && m.gatheringPool.length > 0, `${m.id} has gathering pool`);
      assert.ok(Math.abs(m.gatheringPool.reduce((s, e) => s + e.weight, 0) - 100) < .001, `${m.id} gathering weights total 100`);
      assert.ok(m.gatheringPool.every(e => allowed.includes(e.itemId) && Number.isFinite(Number(e.weight)) && e.weight >= 0), `${m.id} exact allow-list and non-negative weights`);
      assert.ok(!m.gatheringPool.some(e => e.itemId === 'mat_meat'), `${m.id} never gathers Meat`);
    }
  }
  for (const entry of m.monsters) assert.ok(monsters.has(entry.monsterId), `${m.id} references ${entry.monsterId}`);
}
for (const f of ['map-background.png', 'pinpoint.png']) assert.deepEqual(fs.readFileSync(path.join(__dirname, '../project', f)), fs.readFileSync(path.join(__dirname, `../apps/frontend/assets/maps/${f}`)), `${f} asset mirror`);
console.log(`Validated ${root.length} world locations, zero level gates, 5 Towns, 36 grind rosters, ${gatherableByMap.size} assigned gathering pools (empty pools allowed), coordinate bounds, catalogue parity and art asset integrity.`);
