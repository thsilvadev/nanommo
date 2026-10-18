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
for (const m of root) {
  assert.equal(Number.isInteger(m.coordinates.x) && Number.isInteger(m.coordinates.y), true, `${m.id} integer coordinates`);
  assert.ok(m.coordinates.x + 8 >= 1 && m.coordinates.x + 8 <= 15 && 7 - m.coordinates.y >= 1 && 7 - m.coordinates.y <= 13, `${m.id} within 15x13 grid`);
  assert.equal(m.isClickable, true, `${m.id} clickable`);
  assert.equal(m.unlockLevel, 0, `${m.id} has no level gate`);
  if (m.type === 'town') { assert.deepEqual(m.monsters, [], `${m.id} peaceful`); assert.ok(m.npcIds.includes('storage'), `${m.id} has Storage`); }
  else { assert.ok(m.monsters.length, `${m.id} roster exists`); assert.ok(Math.abs(m.monsters.reduce((s, e) => s + e.presenceRate, 0) - 100) < .02, `${m.id} weights total 100`); }
  for (const entry of m.monsters) assert.ok(monsters.has(entry.monsterId), `${m.id} references ${entry.monsterId}`);
}
for (const f of ['map-background.png', 'pinpoint.png']) assert.deepEqual(fs.readFileSync(path.join(__dirname, '../project', f)), fs.readFileSync(path.join(__dirname, `../apps/frontend/assets/maps/${f}`)), `${f} asset mirror`);
console.log('Validated 41 world locations, zero level gates, 5 Towns, 36 grind rosters, coordinate bounds, catalogue parity and art asset integrity.');
