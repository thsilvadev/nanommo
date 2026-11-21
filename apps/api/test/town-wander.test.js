// Direct-execution Node test: `node apps/api/test/town-wander.test.js`
// (after `pnpm --filter @nanommo/shared build`).
const assert = require('node:assert/strict');
const { TownNav, positionAt, TOWN_LEG_MS, TOWN_WALK_SPEED, TOWN_STAIRS_LENGTH, balconyStairsFoot, obstacleRadius, TOWN_MOVE_SPEED, TOWN_MOVE_RESUME_MS, townMoveArrival } = require('../../../packages/shared/dist');

assert.equal(typeof positionAt, 'function', 'positionAt is not a function');
assert.equal(typeof TownNav, 'function', 'TownNav is not a function');
assert.equal(TOWN_LEG_MS, 24000);
assert.equal(TOWN_WALK_SPEED, 2.2);

const fixture = {
  mapId: 'map_fixture',
  size: { w: 30, h: 30 },
  ground: { base: '#555555', accent: '#444444', pattern: 'stone' },
  lighting: { preset: 'day', ambient: '#ffffff', ambientIntensity: 0.5, sun: null, points: [], spot: null },
  fog: { color: '#000000', near: 20, far: 60 },
  obstacles: [{ kind: 'fountain', x: 15, z: 15, r: 3 }],
  npcSpots: {},
  pointsOfInterest: [
    { id: 'nw', x: 6, z: 6, radius: 2, weight: 1, lookAt: [15, 15] },
    { id: 'ne', x: 24, z: 6, radius: 2, weight: 2, lookAt: [15, 15] },
    { id: 'sw', x: 6, z: 24, radius: 2, weight: 3, lookAt: [15, 15] },
    { id: 'se', x: 24, z: 24, radius: 2, weight: 1 },
  ],
  spawn: { x: 15, z: 26 },
};

const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);
const awake = seed => ({ seed, sleeping: null, wakeFrom: null });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('deterministic', () => {
  const a = new TownNav(fixture);
  const b = new TownNav(fixture);
  for (let i = 0; i < 50; i++) {
    const t = T0 + i * 3_517;
    assert.deepStrictEqual(positionAt(fixture, a, awake(12345), t), positionAt(fixture, b, awake(12345), t));
  }
});

test('fountain is blocked, open ground is free', () => {
  const nav = new TownNav(fixture);
  assert.equal(nav.blocked(15, 15), true);
  assert.equal(nav.blocked(2, 2), false);
  assert.equal(nav.blocked(-1, 2), true, 'out of bounds is blocked');
  assert.ok(nav.freeCellCount() > 800 && nav.freeCellCount() < 900);
});

test('never blocked', () => {
  const nav = new TownNav(fixture);
  for (let i = 0; i < 10_000; i++) {
    const p = positionAt(fixture, nav, awake(i), T0 + i * 997);
    assert.equal(nav.blocked(Math.floor(p.x), Math.floor(p.z)), false, `seed ${i} at (${p.x}, ${p.z})`);
  }
});

test('stops at poi', () => {
  const nav = new TownNav(fixture);
  const seed = 777;
  let idleNearPoi = false;
  let walked = false;
  let prev = null;
  const restarts = []; // idle -> walk transitions
  let walkToIdleSinceRestart = 0;
  for (let t = T0; t < T0 + 20 * TOWN_LEG_MS; t += 100) {
    const p = positionAt(fixture, nav, awake(seed), t);
    if (p.state === 'walk') walked = true;
    if (p.state === 'idle' && fixture.pointsOfInterest.some(poi => dist(p, poi) <= poi.radius + 1e-9)) idleNearPoi = true;
    if (prev && prev.state === 'walk' && p.state === 'idle') walkToIdleSinceRestart++;
    if (prev && prev.state === 'idle' && p.state === 'walk') {
      if (restarts.length) assert.ok(walkToIdleSinceRestart >= 1, 'idle -> walk without having arrived');
      restarts.push(t);
      walkToIdleSinceRestart = 0;
    }
    prev = p;
  }
  assert.ok(idleNearPoi, 'never idled at a POI');
  assert.ok(walked, 'never walked');
  assert.ok(restarts.length >= 5, `too few legs observed: ${restarts.length}`);
  for (let i = 1; i < restarts.length; i++) {
    const legs = (restarts[i] - restarts[i - 1]) / TOWN_LEG_MS;
    assert.ok(Math.abs(legs - Math.round(legs)) * TOWN_LEG_MS <= 100, `idle -> walk mid-leg (${legs} legs apart)`);
  }
});

test('continuous', () => {
  const nav = new TownNav(fixture);
  const maxStep = TOWN_WALK_SPEED * 0.1 * 1.5 + 1e-6;
  for (const seed of [1, 42, 999, 123456]) {
    let prev = positionAt(fixture, nav, awake(seed), T0);
    for (let t = T0 + 100; t < T0 + 10 * TOWN_LEG_MS; t += 100) {
      const p = positionAt(fixture, nav, awake(seed), t);
      assert.ok(dist(prev, p) <= maxStep, `seed ${seed} jumped ${dist(prev, p)} at t=${t - T0}`);
      prev = p;
    }
  }
});

test('sleep freezes', () => {
  const nav = new TownNav(fixture);
  const T = T0 + 5 * TOWN_LEG_MS + 3_333;
  const ref = positionAt(fixture, nav, awake(55), T);
  for (const t of [T, T + 1, T + 10_000, T + 1_000_000]) {
    const p = positionAt(fixture, nav, { seed: 55, sleeping: { at: T }, wakeFrom: null }, t);
    assert.deepStrictEqual(p, { ...ref, state: 'sleep' });
  }
});

test('wake starts from wakeFrom', () => {
  const nav = new TownNav(fixture);
  for (const offset of [100, 6_000, 12_500, 23_000]) {
    const T = T0 + 7 * TOWN_LEG_MS + offset;
    const entry = { seed: 31337, sleeping: null, wakeFrom: { x: 15.5, z: 8.5, at: T } };
    const p = positionAt(fixture, nav, entry, T);
    assert.ok(Math.hypot(p.x - 15.5, p.z - 8.5) < 1e-6, `offset ${offset}: (${p.x}, ${p.z})`);
    let prev = p;
    for (let t = T + 100; t < T + 3 * TOWN_LEG_MS; t += 100) {
      const q = positionAt(fixture, nav, entry, t);
      assert.ok(dist(prev, q) <= TOWN_WALK_SPEED * 0.1 * 1.5 + 1e-6, `offset ${offset}: jump after wake at ${t - T}`);
      prev = q;
    }
  }
});

test('different seeds diverge', () => {
  const nav = new TownNav(fixture);
  let different = 0;
  for (let i = 0; i < 100; i++) {
    const t = T0 + i * 7_919;
    if (dist(positionAt(fixture, nav, awake(1), t), positionAt(fixture, nav, awake(2), t)) > 0.5) different++;
  }
  assert.ok(different >= 90, `only ${different}/100 samples diverged`);
});

test('path avoids the fountain and keeps its endpoints', () => {
  const nav = new TownNav(fixture);
  const path = nav.path(15.5, 8.5, 15.5, 22.5);
  assert.deepStrictEqual(path[0], [15.5, 8.5]);
  assert.deepStrictEqual(path.at(-1), [15.5, 22.5]);
  assert.ok(path.length >= 3, 'path went straight through the fountain');
  assert.ok(nav.reachableFrom(15, 26).has(8 * 30 + 15));
});

const balconyFixture = (o) => ({ ...fixture, obstacles: [o], pointsOfInterest: [], npcSpots: {} });
const BALCONY = { kind: 'balcony', x: 10, z: 10, w: 6, d: 4, height: 3, stairs: 'e', rot: 0 };

test('balcony blocks its platform and its stairs, the stairs foot stays free', () => {
  assert.equal(TOWN_STAIRS_LENGTH, 2.5);
  const nav = new TownNav(balconyFixture(BALCONY));
  for (let x = 7; x <= 12; x++) for (let z = 8; z <= 11; z++) assert.equal(nav.blocked(x, z), true, `platform cell ${x},${z}`);
  // Stairs strip: x from 13 to 15.5, z from 9 to 11.
  for (const x of [13, 14, 15]) for (const z of [9, 10]) assert.equal(nav.blocked(x, z), true, `stairs cell ${x},${z}`);
  // Outside the 2u-wide stairs strip, next to the platform's east edge, the ground is free.
  assert.equal(nav.blocked(14, 7), false, 'beside the stairs (north) is free');
  assert.equal(nav.blocked(14, 12), false, 'beside the stairs (south) is free');
  assert.deepStrictEqual(balconyStairsFoot(BALCONY), { x: 16.5, z: 10 });
  assert.equal(nav.blocked(16, 10), false, 'stairs foot is free');
});

test('balcony stairs foot rotates with the obstacle', () => {
  const rotated = { ...BALCONY, rot: 90 };
  const foot = balconyStairsFoot(rotated);
  assert.ok(Math.abs(foot.x - 10) < 1e-9 && Math.abs(foot.z - 3.5) < 1e-9, JSON.stringify(foot));
  const nav = new TownNav(balconyFixture(rotated));
  assert.equal(nav.blocked(Math.floor(foot.x), Math.floor(foot.z)), false, 'rotated foot is free');
  assert.equal(nav.blocked(10, 5), true, 'rotated stairs are blocked');
  assert.deepStrictEqual(balconyStairsFoot({ ...BALCONY, stairs: 'w' }), { x: 3.5, z: 10 });
  assert.deepStrictEqual(balconyStairsFoot({ ...BALCONY, stairs: 's' }), { x: 10, z: 15.5 });
  assert.deepStrictEqual(balconyStairsFoot({ ...BALCONY, stairs: 'n' }), { x: 10, z: 4.5 });
});

test('tower and campfire default radii', () => {
  assert.equal(obstacleRadius({ kind: 'tower', x: 0, z: 0 }), 4);
  assert.equal(obstacleRadius({ kind: 'campfire', x: 0, z: 0 }), 1.2);
  assert.equal(obstacleRadius({ kind: 'altar', x: 0, z: 0 }), 4.5);
  assert.equal(obstacleRadius({ kind: 'well', x: 0, z: 0 }), 1.4);
  const nav = new TownNav(balconyFixture({ kind: 'campfire', x: 15, z: 15 }));
  assert.equal(nav.blocked(15, 15), true);
  assert.equal(nav.blocked(17, 15), false);
});

const realTowns = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../town_scenes.json'), 'utf8')).towns;
for (const mapId of ['map_emperial_capital_caelum', 'map_kwaioua_taba', 'map_outpost', 'map_aramaia_city', 'map_town']) {
  test(`${mapId}: never blocked (balconies, stairs, campfire, tower)`, () => {
    const def = realTowns.find(t => t.mapId === mapId);
    assert.ok(def, `${mapId} scene`);
    const nav = new TownNav(def);
    for (let i = 0; i < 10_000; i++) {
      const p = positionAt(def, nav, awake(i), i * 997);
      assert.equal(nav.blocked(Math.floor(p.x), Math.floor(p.z)), false, `seed ${i} at (${p.x}, ${p.z})`);
    }
  });
}

// ---- click-to-move, emotes ----------------------------------------------------

const moving = (seed, move, extra = {}) => ({ ...awake(seed), move, ...extra });

test('click-to-move walks the path at TOWN_MOVE_SPEED, stands 10 s, then wanders from there', () => {
  const nav = new TownNav(fixture);
  const move = { fromX: 4, fromZ: 26, toX: 26, toZ: 26, at: T0, lookAt: null };
  const arrive = townMoveArrival(nav, move);
  // Straight open ground: 22 units.
  assert.ok(Math.abs((arrive - T0) / 1000 - 22 / TOWN_MOVE_SPEED) < 1e-6);
  const mid = positionAt(fixture, nav, moving(7, move), T0 + 2000);
  assert.equal(mid.state, 'walk');
  assert.ok(Math.abs(mid.x - (4 + 2 * TOWN_MOVE_SPEED)) < 1e-6 && Math.abs(mid.z - 26) < 1e-6);
  const there = positionAt(fixture, nav, moving(7, move), arrive + 100);
  assert.deepStrictEqual([there.x, there.z, there.state], [26, 26, 'idle']);
  const still = positionAt(fixture, nav, moving(7, move), arrive + TOWN_MOVE_RESUME_MS - 1);
  assert.deepStrictEqual([still.x, still.z, still.state], [26, 26, 'idle']);
  const resumed = positionAt(fixture, nav, moving(7, move), arrive + TOWN_MOVE_RESUME_MS + 1500);
  assert.equal(resumed.state, 'walk', 'starts walking right after the pause');
  assert.ok(dist(resumed, { x: 26, z: 26 }) < 1.5 * TOWN_WALK_SPEED * 3, 'leaves from the click destination');
});

test('click-to-move: resumed wander is continuous and later joins the plain legs', () => {
  const nav = new TownNav(fixture);
  for (const seed of [1, 2, 3, 99, 4242]) {
    const move = { fromX: 4, fromZ: 26, toX: 6, toZ: 6, at: T0 + seed * 777, lookAt: [15, 15] };
    const entry = moving(seed, move);
    const arrive = townMoveArrival(nav, move);
    let prev = positionAt(fixture, nav, entry, move.at);
    for (let t = move.at + 100; t < arrive + TOWN_MOVE_RESUME_MS + 3 * TOWN_LEG_MS; t += 100) {
      const p = positionAt(fixture, nav, entry, t);
      assert.ok(dist(p, prev) < 1.5, `seed ${seed}: jump of ${dist(p, prev).toFixed(2)} at +${t - move.at} ms`);
      assert.equal(nav.blocked(Math.floor(p.x), Math.floor(p.z)), false);
      prev = p;
    }
    const late = arrive + TOWN_MOVE_RESUME_MS + 3 * TOWN_LEG_MS;
    assert.deepStrictEqual(positionAt(fixture, nav, entry, late), positionAt(fixture, nav, awake(seed), late), 'back on the plain legs');
  }
});

test('click-to-move: facing the clicked NPC on arrival; a client clock behind holds the start', () => {
  const nav = new TownNav(fixture);
  const move = { fromX: 4, fromZ: 26, toX: 10, toZ: 26, at: T0, lookAt: [10, 30] };
  const there = positionAt(fixture, nav, moving(1, move), townMoveArrival(nav, move) + 10);
  assert.ok(Math.abs(there.facing - 0) < 1e-9, 'faces +Z towards (10, 30)');
  const early = positionAt(fixture, nav, moving(1, move), T0 - 50);
  assert.deepStrictEqual([early.x, early.z, early.state], [4, 26, 'idle']);
});

test('emotes hold the pose at their start, with no time limit', () => {
  const nav = new TownNav(fixture);
  const move = { fromX: 4, fromZ: 26, toX: 26, toZ: 26, at: T0, lookAt: null };
  const at = T0 + 3000;
  const base = positionAt(fixture, nav, moving(5, move), at);
  for (const kind of ['dance', 'sit']) {
    for (const later of [at, at + 60_000, at + 7 * 24 * 3600_000]) {
      const p = positionAt(fixture, nav, moving(5, move, { emote: { kind, at } }), later);
      assert.deepStrictEqual([p.x, p.z, p.facing, p.state], [base.x, base.z, base.facing, kind]);
    }
  }
});

test('sleep keeps the click-to-move base pose', () => {
  const nav = new TownNav(fixture);
  const move = { fromX: 4, fromZ: 26, toX: 26, toZ: 26, at: T0, lookAt: null };
  const at = T0 + 4000;
  const base = positionAt(fixture, nav, moving(5, move), at);
  const p = positionAt(fixture, nav, moving(5, move, { sleeping: { at } }), at + 600_000);
  assert.deepStrictEqual([p.x, p.z, p.state], [base.x, base.z, 'sleep']);
});

test('nearestReachable keeps reachable points and snaps blocked ones next to the obstacle', () => {
  const nav = new TownNav(fixture);
  assert.deepStrictEqual(nav.nearestReachable(5.3, 7.1, fixture.spawn.x, fixture.spawn.z), [5.3, 7.1]);
  const snapped = nav.nearestReachable(15, 15, fixture.spawn.x, fixture.spawn.z);
  assert.equal(nav.blocked(Math.floor(snapped[0]), Math.floor(snapped[1])), false);
  assert.ok(Math.hypot(snapped[0] - 15, snapped[1] - 15) < 4.5, 'right at the fountain edge');
  const outside = nav.nearestReachable(-10, 5, fixture.spawn.x, fixture.spawn.z);
  assert.equal(outside[0], 0.5);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.error(`FAIL - ${name}\n  ${e.message}`); }
}
if (failed) { console.error(`${failed}/${tests.length} failed`); process.exit(1); }
console.log(`${tests.length}/${tests.length} passed`);
