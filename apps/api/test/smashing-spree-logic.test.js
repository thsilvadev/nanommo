const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const { TownNav } = require('../../../packages/shared/dist');
const { phaseAt, placeVases, assignPrizes, eventSeed } = require('../dist/apps/api/src/modules/town-event/smashing-spree.logic');

const cfg = require(path.join(root, 'town_events.json')).smashingSpree;
const at = (iso) => phaseAt(Date.parse(iso), cfg);
const start930 = Date.parse('2026-11-24T09:30:00-03:00');

// Announcements: 30, 15, 5, 1 minutes before.
assert.deepEqual(at('2026-11-24T09:00:10-03:00'), { kind: 'announce', eventKey: `ss-${start930}`, startMs: start930, minutes: 30 });
assert.equal(at('2026-11-24T09:15:00-03:00').minutes, 15);
assert.equal(at('2026-11-24T09:25:59-03:00').minutes, 5);
assert.equal(at('2026-11-24T09:29:30-03:00').minutes, 1);
const p0329 = at('2026-11-24T03:29:59-03:00');
assert.equal(p0329.kind, 'announce'); assert.equal(p0329.minutes, 1); assert.equal(p0329.startMs, Date.parse('2026-11-24T03:30:00-03:00'));
// Start and end.
assert.deepEqual(at('2026-11-24T09:30:05-03:00'), { kind: 'start', eventKey: `ss-${start930}`, startMs: start930, endsAt: start930 + 300000 });
assert.deepEqual(at('2026-11-24T09:35:00-03:00'), { kind: 'end', eventKey: `ss-${start930}`, startMs: start930 });
assert.equal(at('2026-11-24T09:31:00-03:00'), null);
assert.equal(at('2026-11-24T09:34:00-03:00'), null);
assert.equal(at('2026-11-24T12:00:00-03:00'), null);
assert.equal(at('2026-11-24T15:30:00-03:00').kind, 'start');
assert.equal(at('2026-11-24T21:30:00-03:00').kind, 'start');
assert.equal(at('2026-11-24T21:00:00-03:00').minutes, 30);
// Same instant expressed in UTC gives the same phase (timezone handled, not the host's).
assert.deepEqual(at('2026-11-24T12:30:05Z'), at('2026-11-24T09:30:05-03:00'));
assert.equal(at('2026-11-24T09:30:00Z'), null);

// Placement.
const towns = require(path.join(root, 'town_scenes.json')).towns;
assert.equal(towns.length, 5);
// Sierra Village only, 500 vases, five minutes (user, 2026-11-24).
assert.equal(cfg.townMapId, 'map_town');
assert.equal(cfg.vasesPerTown, 500);
assert.equal(cfg.durationSeconds, 300);
for (const def of towns.filter((t) => t.mapId === cfg.townMapId)) {
  const nav = new TownNav(def);
  const seed = eventSeed(`ss-${start930}`, def.mapId);
  const vases = placeVases(def, nav, seed, cfg);
  assert.equal(vases.length, 500, def.mapId);
  assert.deepEqual(vases.map(v => v.id), Array.from({ length: 500 }, (_, i) => `v${String(i).padStart(3, '0')}`));
  const reach = nav.reachableFrom(def.spawn.x, def.spawn.z);
  for (const v of vases) {
    const cx = Math.floor(v.x), cz = Math.floor(v.z);
    assert.ok(!nav.blocked(cx, cz), `${def.mapId} ${v.id} blocked`);
    assert.ok(reach.has(cz * nav.w + cx), `${def.mapId} ${v.id} unreachable`);
    assert.ok(v.rot >= 0 && v.rot < Math.PI * 2);
    assert.ok([0, 1, 2].includes(v.variant));
    for (const spot of [...Object.values(def.npcSpots), def.spawn]) assert.ok(Math.hypot(v.x - spot.x, v.z - spot.z) >= 2.0, `${def.mapId} ${v.id} too close to npc/spawn`);
  }
  for (let i = 0; i < vases.length; i++) for (let j = i + 1; j < vases.length; j++) {
    assert.ok(Math.hypot(vases[i].x - vases[j].x, vases[i].z - vases[j].z) >= cfg.minVaseSpacing, `${def.mapId} spacing`);
  }
  assert.deepEqual(placeVases(def, nav, seed, cfg), vases, 'deterministic');
  assert.notDeepEqual(placeVases(def, nav, seed + 1, cfg), vases, 'seed changes layout');
}

// Prizes.
const vases = placeVases(towns[0], new TownNav(towns[0]), 7, cfg);
const prizes = assignPrizes(vases, 7, cfg);
assert.equal(prizes.size, 40);
const counts = {};
for (const p of prizes.values()) counts[p.itemId] = (counts[p.itemId] ?? 0) + 1;
assert.equal(counts.mega_elixir, 20); assert.equal(counts.tonic_fontoura, 2); assert.equal(counts.tonic_kombucha, 2);
assert.equal(counts.tonic_haste_shot, 2); assert.equal(counts.tonic_capo, 2); assert.equal(counts.mat_bliss_stone, 8); assert.equal(counts.mat_divine_shard, 2);
// one Fairy-or-Sapupema vase plus one fixed Sapupema vase
assert.equal((counts.fairy_in_a_bottle ?? 0) + (counts.super_tonic_sapupema_tea ?? 0), 2);
assert.ok((counts.super_tonic_sapupema_tea ?? 0) >= 1);
for (const p of prizes.values()) if (p.itemId === 'mega_elixir') assert.equal(p.quantity, 20);
for (const id of prizes.keys()) assert.ok(vases.some(v => v.id === id));
assert.deepEqual([...assignPrizes(vases, 7, cfg)], [...prizes], 'deterministic prizes');
const oneOfSeen = new Set();
for (let s = 1; s <= 200; s++) for (const p of assignPrizes(vases, s, cfg).values()) if (p.itemId === 'fairy_in_a_bottle' || p.itemId === 'super_tonic_sapupema_tea') oneOfSeen.add(p.itemId);
assert.equal(oneOfSeen.size, 2);
assert.notEqual(eventSeed('a', 'map_town'), eventSeed('a', 'map_outpost'));
console.log('smashing-spree-logic passed');
