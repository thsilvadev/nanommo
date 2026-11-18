// Direct-execution Node test: `node apps/api/test/town-scenes-catalog.test.js`
// (after `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '../../..');
const { TownNav, validateTownScenes } = require(path.join(repo, 'packages/shared/dist'));

const read = rel => JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const TOWNS = ['map_aramaia_city', 'map_emperial_capital_caelum', 'map_kwaioua_taba', 'map_town'];
const root = read('town_scenes.json');
const maps = read('maps.json');
const mapById = new Map(maps.maps.map(m => [m.id, m]));

test('mirror matches root', () => {
  assert.deepStrictEqual(read('apps/frontend/public/data/town_scenes.json'), root);
});

test('exactly the four towns', () => {
  assert.deepStrictEqual(root.towns.map(t => t.mapId).sort(), TOWNS);
});

for (const def of root.towns) {
  test(`${def.mapId}: size, free area and POI count`, () => {
    assert.deepStrictEqual(def.size, { w: 72, h: 72 });
    const nav = new TownNav(def);
    assert.ok(nav.freeCellCount() >= 2500, `free cells ${nav.freeCellCount()}`);
    assert.ok(def.pointsOfInterest.length >= 16, `POIs ${def.pointsOfInterest.length}`);
    assert.equal(new Set(def.pointsOfInterest.map(p => p.id)).size, def.pointsOfInterest.length, 'unique POI ids');
  });

  test(`${def.mapId}: every NPC has a free, reachable spot next to a POI`, () => {
    const nav = new TownNav(def);
    const reach = nav.reachableFrom(def.spawn.x, def.spawn.z);
    const cell = (x, z) => Math.floor(z) * def.size.w + Math.floor(x);
    for (const npcId of mapById.get(def.mapId).npcIds) {
      const spot = def.npcSpots[npcId];
      assert.ok(spot, `${npcId} has no npcSpot`);
      assert.equal(nav.blocked(Math.floor(spot.x), Math.floor(spot.z)), false, `${npcId} spot blocked`);
      assert.ok(reach.has(cell(spot.x, spot.z)), `${npcId} spot unreachable`);
      assert.ok(def.pointsOfInterest.some(p => Math.hypot(p.x - spot.x, p.z - spot.z) <= 3), `${npcId} has no POI within 3u`);
    }
    for (const poi of def.pointsOfInterest) {
      assert.equal(nav.blocked(Math.floor(poi.x), Math.floor(poi.z)), false, `${poi.id} blocked`);
      assert.ok(reach.has(cell(poi.x, poi.z)), `${poi.id} unreachable from spawn`);
    }
  });
}

test('art direction per town', () => {
  const by = Object.fromEntries(root.towns.map(t => [t.mapId, t]));
  const caelum = by.map_emperial_capital_caelum;
  assert.equal(caelum.lighting.preset, 'night');
  assert.ok(caelum.obstacles.some(o => o.kind === 'fountain' && o.r === 3), 'Caelum fountain r=3');
  assert.ok(caelum.obstacles.filter(o => o.kind === 'lamp').length >= 8, 'Caelum >= 8 lamps');
  assert.ok(caelum.lighting.points.length >= 8, 'Caelum warm lamp lights');
  const sierra = by.map_town;
  assert.equal(sierra.lighting.preset, 'day');
  assert.equal(sierra.ground.pattern, 'dirt');
  assert.ok(sierra.lighting.sun, 'Sierra has a sun');
  const taba = by.map_kwaioua_taba;
  assert.equal(taba.lighting.preset, 'dusk');
  assert.equal(taba.ground.pattern, 'grass');
  assert.ok(taba.obstacles.filter(o => o.kind === 'hut').length >= 6, 'Taba hut ring');
  assert.ok(taba.obstacles.filter(o => o.kind === 'tall_tree').every(o => o.height >= 10), 'tall trees >= 10');
  const aramaia = by.map_aramaia_city;
  assert.equal(aramaia.lighting.preset, 'sunshaft');
  assert.equal(aramaia.ground.pattern, 'stone');
  assert.ok(aramaia.lighting.ambientIntensity <= 0.15);
  assert.equal(aramaia.lighting.spot.color, '#ffd36a');
  assert.ok(aramaia.obstacles.some(o => o.kind === 'pyramid_wall') && aramaia.obstacles.some(o => o.kind === 'pillar'));
});

test('validateTownScenes accepts the catalogue and rejects broken entries', () => {
  assert.deepStrictEqual(validateTownScenes(root, maps), []);
  const bad = JSON.parse(JSON.stringify(root));
  bad.towns[0].mapId = 'map_nope';
  assert.ok(validateTownScenes(bad, maps).some(e => e.includes('map_nope')));
  const noSpot = JSON.parse(JSON.stringify(root));
  const npc = Object.keys(noSpot.towns[1].npcSpots)[0];
  delete noSpot.towns[1].npcSpots[npc];
  assert.ok(validateTownScenes(noSpot, maps).some(e => e.includes(npc)));
});

test('scripts/validate-town-scenes.js exits 0', () => {
  const run = spawnSync(process.execPath, [path.join(repo, 'scripts/validate-town-scenes.js')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test('DataService loads town scenes', () => {
  const { DataService } = require(path.join(repo, 'apps/api/dist/apps/api/src/modules/data/data.service'));
  const cwd = process.cwd();
  process.chdir(path.join(repo, 'apps/api'));
  try {
    const data = new DataService();
    data.onModuleInit();
    assert.deepStrictEqual(data.getTownSceneMapIds().sort(), TOWNS);
    assert.equal(data.getTownScene('map_town').mapId, 'map_town');
    assert.equal(data.getTownScene('map_outpost'), null);
  } finally {
    process.chdir(cwd);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.error(`FAIL - ${name}\n  ${e.message}`); }
}
if (failed) { console.error(`${failed}/${tests.length} failed`); process.exit(1); }
console.log(`${tests.length}/${tests.length} passed`);
