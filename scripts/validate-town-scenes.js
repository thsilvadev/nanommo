#!/usr/bin/env node
// Validates town_scenes.json against maps.json with the same rules the API
// enforces at boot (validateTownScenes from @nanommo/shared; build it first),
// plus root/frontend mirror parity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TownNav, validateTownScenes } = require('../packages/shared/dist');

const root = path.join(__dirname, '..');
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const scenes = read('town_scenes.json');
const maps = read('maps.json');

const errors = validateTownScenes(scenes, maps);
if (errors.length) {
  console.error(`town_scenes.json is invalid:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
assert.deepStrictEqual(read('apps/frontend/public/data/town_scenes.json'), scenes, 'frontend town_scenes.json mirrors the root catalogue (run node scripts/sync-frontend-data.js)');

for (const def of scenes.towns) {
  const nav = new TownNav(def);
  console.log(`${def.mapId}: ${nav.freeCellCount()} free cells, ${def.pointsOfInterest.length} POIs, ${Object.keys(def.npcSpots).length} NPC spots, ${def.obstacles.length} obstacles`);
}
console.log(`Validated ${scenes.towns.length} town scenes and the frontend mirror.`);
