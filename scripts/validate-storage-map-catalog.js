#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const maps = read('maps.json');
const publicMaps = read('apps/frontend/public/data/maps.json');
const npcs = read('npc_catalog.json').npcs;
const publicNpcCatalog = fs.existsSync(path.join(root, 'apps/frontend/public/data/npc_catalog.json')) ? read('apps/frontend/public/data/npc_catalog.json').npcs : null;
assert.deepEqual(publicMaps, maps, 'frontend map catalogue must exactly mirror root maps.json');
const towns = maps.maps.filter((map) => map.type === 'town');
assert.ok(towns.length >= 1, 'at least one canonical type=town map is required');
const storage = npcs.filter((npc) => npc.id === 'storage');
assert.equal(storage.length, 1, 'exactly one canonical Storage NPC must exist');
assert.equal(storage[0].name, 'Storage');
assert.equal(storage[0].location, 'town');
assert.deepEqual(storage[0].types, ['storage']);
assert.equal(typeof storage[0].monologue, 'string');
assert.ok(storage[0].monologue.trim().length > 0, 'Storage monologue must be non-empty and may be localized/edited');
for (const map of towns) assert.ok(Array.isArray(map.npcIds) && map.npcIds.includes('storage'), `Town map ${map.id} must reference storage`);
const mapIds = new Set();
const mapCoordinates = new Set();
for (const map of maps.maps) {
  assert.ok(typeof map.id === 'string' && map.id.length > 0 && !mapIds.has(map.id), `map IDs must be unique: ${map.id}`);
  mapIds.add(map.id);
  assert.ok(Number.isFinite(map.coordinates?.x) && Number.isFinite(map.coordinates?.y), `${map.id} must have finite board coordinates`);
  const coordinateKey = `${map.coordinates.x},${map.coordinates.y}`;
  assert.ok(!mapCoordinates.has(coordinateKey), `map coordinates must be unique: ${coordinateKey}`);
  mapCoordinates.add(coordinateKey);
}
if (publicNpcCatalog) assert.deepEqual(publicNpcCatalog, npcs, 'frontend NPC catalogue must exactly mirror root npc_catalog.json');
console.log(`storage/map catalogue validation: passed (${towns.length} Town map(s), one Storage NPC, ${maps.maps.length} ordered maps)`);
