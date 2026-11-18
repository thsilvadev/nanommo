// Direct-execution Node test: `node apps/api/test/town-scenes-catalog.test.js`
// (after `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '../../..');
const { TownNav, validateTownScenes, balconyContains, balconyStairsFoot, obstacleRadius } = require(path.join(repo, 'packages/shared/dist'));

const read = rel => JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const TOWNS = ['map_aramaia_city', 'map_emperial_capital_caelum', 'map_kwaioua_taba', 'map_outpost', 'map_town'];
const root = read('town_scenes.json');
const maps = read('maps.json');
const mapById = new Map(maps.maps.map(m => [m.id, m]));

test('mirror matches root', () => {
  assert.deepStrictEqual(read('apps/frontend/public/data/town_scenes.json'), root);
});

test('exactly the five towns', () => {
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
      let ground = spot;
      if (spot.y > 0) {
        // Up on a balcony: players walk to the foot of its stairs.
        const balcony = def.obstacles.find(o => balconyContains(o, spot.x, spot.z));
        assert.ok(balcony, `${npcId} is elevated but not on a balcony`);
        ground = balconyStairsFoot(balcony);
      }
      assert.equal(nav.blocked(Math.floor(ground.x), Math.floor(ground.z)), false, `${npcId} spot blocked`);
      assert.ok(reach.has(cell(ground.x, ground.z)), `${npcId} spot unreachable`);
      assert.ok(def.pointsOfInterest.some(p => Math.hypot(p.x - ground.x, p.z - ground.z) <= 3), `${npcId} has no POI within 3u`);
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
  assert.ok(caelum.obstacles.some(o => o.kind === 'fountain' && o.r === 3), 'Caelum fountain r=3');
  assert.ok(caelum.obstacles.filter(o => o.kind === 'lamp').length >= 8, 'Caelum >= 8 lamps (unlit by day)');
  const sierra = by.map_town;
  assert.equal(sierra.lighting.preset, 'day');
  assert.equal(sierra.ground.pattern, 'dirt');
  assert.ok(sierra.lighting.sun, 'Sierra has a sun');
  const taba = by.map_kwaioua_taba;
  assert.equal(taba.lighting.preset, 'dusk');
  assert.ok(taba.lighting.points.some(p => p.x === 36 && p.z === 36), 'Taba campfire light');
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

test('Caelum at noon, with half the houses and two balconies', () => {
  const caelum = root.towns.find(t => t.mapId === 'map_emperial_capital_caelum');
  assert.equal(caelum.lighting.preset, 'day');
  assert.ok(caelum.lighting.sun && caelum.lighting.sun.intensity >= 1.4, 'strong noon sun');
  assert.ok(caelum.lighting.ambientIntensity >= 0.5, 'bright ambient');
  assert.equal(caelum.lighting.points.length, 0, 'no lamp lights by day');
  assert.equal(caelum.obstacles.filter(o => o.kind === 'house').length, 20, '20 houses');
  assert.ok(caelum.obstacles.filter(o => o.kind === 'balcony').length >= 2, '>= 2 balconies');
  assert.ok(caelum.npcSpots.father_marcelus.y > 0, 'Father Marcelus up on a balcony');
  assert.ok(caelum.npcSpots.oracle.y > 0, 'Oracle up on a balcony');
});

test('Kwaioua Taba has a campfire in the middle', () => {
  const taba = root.towns.find(t => t.mapId === 'map_kwaioua_taba');
  const fire = taba.obstacles.find(o => o.kind === 'campfire' && o.x === 36 && o.z === 36);
  assert.ok(fire, 'campfire at (36,36)');
  const r = obstacleRadius(fire);
  for (const poi of taba.pointsOfInterest) {
    assert.ok(Math.hypot(poi.x - 36, poi.z - 36) >= r + 0.4 + poi.radius, `${poi.id} too close to the fire`);
  }
  assert.ok(!taba.pointsOfInterest.some(p => p.id === 'patio'), 'patio POI replaced');
});

test('Outpost has a tower whose top the camera never sees, with its NPCs around it', () => {
  const outpost = root.towns.find(t => t.mapId === 'map_outpost');
  assert.ok(outpost, 'Outpost scene');
  const tower = outpost.obstacles.find(o => o.kind === 'tower');
  assert.ok(tower, 'Outpost tower');
  const maxCameraHeight = 70 * Math.sin((55 * Math.PI) / 180);
  assert.ok(tower.height >= 80 && 80 > maxCameraHeight, `tower height ${tower.height} vs camera ${maxCameraHeight}`);
  for (const npcId of ['storage', 'mailbox', 'william', 'father_marcelus']) {
    const spot = outpost.npcSpots[npcId];
    assert.ok(spot && Math.hypot(spot.x - tower.x, spot.z - tower.z) <= 10, `${npcId} within 10u of the tower`);
  }
});

for (const [mapId, kind, replaced] of [['map_aramaia_city', 'altar', 'sunshaft'], ['map_town', 'well', 'square']]) {
  test(`${mapId}: ${kind} in the middle of the town`, () => {
    const def = root.towns.find(t => t.mapId === mapId);
    const centre = def.obstacles.find(o => o.kind === kind && o.x === 36 && o.z === 36);
    assert.ok(centre, `${kind} at (36,36)`);
    const r = obstacleRadius(centre);
    for (const poi of def.pointsOfInterest) {
      assert.ok(Math.hypot(poi.x - 36, poi.z - 36) >= r + 0.4 + poi.radius, `${poi.id} overlaps the ${kind}`);
    }
    assert.ok(!def.pointsOfInterest.some(p => p.id === replaced), `${replaced} POI replaced`);
  });
}

// Caelum copy with the house at (59,47) turned into a balcony whose stairs face west (foot at 52,47).
function caelumWithBalcony({ y = 3.2, poi = [52.5, 47.5], spot = [59, 47] } = {}) {
  const copy = JSON.parse(JSON.stringify(root));
  const caelum = copy.towns.find(t => t.mapId === 'map_emperial_capital_caelum');
  caelum.obstacles = caelum.obstacles.filter(o => !(['house', 'balcony'].includes(o.kind) && o.x === 59 && o.z === 47));
  caelum.obstacles.push({ kind: 'balcony', x: 59, z: 47, w: 7, d: 6, height: 3.2, stairs: 'w' });
  caelum.npcSpots.oracle = { x: spot[0], z: spot[1], facing: -90, y };
  const p = caelum.pointsOfInterest.find(q => q.id === 'npc_oracle');
  p.x = poi[0]; p.z = poi[1]; p.lookAt = [59, 47];
  return copy;
}

test('validator: an NPC up on a balcony is valid with a POI by the stairs foot', () => {
  assert.deepStrictEqual(validateTownScenes(caelumWithBalcony(), maps), []);
});

test('validator: an NPC up on a balcony needs a POI by the stairs foot', () => {
  const errors = validateTownScenes(caelumWithBalcony({ poi: [40.69, 59] }), maps);
  assert.ok(errors.some(e => e.includes('oracle') && e.includes('stairs')), errors.join('\n'));
});

test('validator: an elevated NPC must stand on a balcony', () => {
  const errors = validateTownScenes(caelumWithBalcony({ spot: [42.49, 59], poi: [40.69, 59] }), maps);
  assert.ok(errors.some(e => e.includes('oracle') && e.includes('balcony')), errors.join('\n'));
});

test('validator: a balcony needs w, d, height and stairs', () => {
  const copy = caelumWithBalcony();
  delete copy.towns.find(t => t.mapId === 'map_emperial_capital_caelum').obstacles.at(-1).stairs;
  assert.ok(validateTownScenes(copy, maps).some(e => e.includes('balcony')));
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
    assert.equal(data.getTownScene('map_outpost').mapId, 'map_outpost');
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
