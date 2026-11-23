/** Runs the real gear build (needs ./source, see README) into a temp folder. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { readTargetSkeleton } from '../lib/skeleton.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const build = (out, only) => execFileSync('node', [path.join(here, '../build-gear.mjs'), '--only', only], { env: { ...process.env, GEAR_OUT: out }, stdio: 'pipe' });
const ONLY = 'body-ranger,body-peasant';
const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-'));
const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-'));
build(out1, ONLY);
build(out2, ONLY);
const manifest = JSON.parse(fs.readFileSync(path.join(out1, 'manifest.json'), 'utf8'));

test('manifest lists the built visuals as skinned and maps their items', () => {
  assert.equal(manifest.visuals['body-ranger'].kind, 'skinned');
  assert.equal(manifest.visuals['body-peasant'].kind, 'skinned');
  assert.equal(manifest.items.equip_body_phys_t1, 'body-ranger');
  assert.equal(manifest.atlas, 'gear-atlas.webp');
});

for (const sex of ['male', 'female']) {
  test(`gear-${sex}.glb: one skinned mesh per visual on our 65 joints in body order, atlas UVs, no skin material`, async () => {
    const doc = await new NodeIO().read(path.join(out1, `gear-${sex}.glb`));
    const target = await readTargetSkeleton(sex);
    for (const visual of ['body-ranger', 'body-peasant']) {
      const node = doc.getRoot().listNodes().find((n) => n.getName() === visual);
      assert.ok(node?.getMesh() && node.getSkin(), visual);
      assert.deepEqual(node.getSkin().listJoints().map((j) => j.getName()), target.joints.map((j) => j.name));
      const prims = node.getMesh().listPrimitives();
      assert.equal(prims.length, 1);
      const uv = prims[0].getAttribute('TEXCOORD_0');
      for (let i = 0; i < uv.getCount(); i++) { const [u, v] = uv.getElement(i, []); assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1); }
    }
    for (const m of doc.getRoot().listMaterials()) assert.ok(!/Skin|MI_Regular/.test(m.getName()), m.getName());
  });
}

test('two builds over the same sources are byte-identical', () => {
  for (const f of ['gear-male.glb', 'gear-female.glb', 'gear-rigid.glb', 'gear-atlas.webp', 'manifest.json']) {
    assert.ok(fs.readFileSync(path.join(out1, f)).equals(fs.readFileSync(path.join(out2, f))), f);
  }
});

import { ITEMS, VISUALS } from '../gear.config.mjs';
const repoItems = JSON.parse(fs.readFileSync(path.join(here, '../../../../items.json'), 'utf8')).equipment;

test('every head and cape item has a visual in the config', () => {
  for (const item of repoItems.filter((i) => i.slot === 'head' || i.slot === 'cape')) {
    assert.ok(VISUALS[ITEMS[item.id]], `${item.id} -> ${ITEMS[item.id]}`);
  }
});

test('rigid visuals land in gear-rigid.glb with a finite 16-number transform per sex', async () => {
  const rigid = Object.keys(VISUALS).filter((v) => VISUALS[v].kind === 'rigid' && ['head', 'cape'].includes(VISUALS[v].slot));
  assert.ok(rigid.length >= 10, String(rigid.length));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-'));
  build(out, rigid.join(','));
  const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const doc = await new NodeIO().read(path.join(out, 'gear-rigid.glb'));
  for (const v of rigid) {
    for (const sex of ['male', 'female']) {
      const t = m.visuals[v].transform?.[sex];
      assert.ok(Array.isArray(t) && t.length === 16 && t.every(Number.isFinite), `${v} ${sex}`);
    }
    assert.ok(m.visuals[v].bone, v);
    const node = doc.getRoot().listNodes().find((n) => n.getName() === v);
    assert.ok(node?.getMesh(), v);
  }
});

test('user mapping (2026-11-23): magic hats shifted down for the Magician\'s hat T3; red rogue hood is physical T1', () => {
  assert.deepEqual([ITEMS.equip_head_magic_t1, ITEMS.equip_head_magic_t2, ITEMS.equip_head_magic_t3], ['head-mage-hat', 'head-skeleton-mage-hat', 'head-magician-hat']);
  assert.equal(ITEMS.equip_head_phys_t1, 'head-rogue-hood');
});

test('every shoes item has a visual; elemental boots are the earth boots recoloured', () => {
  for (const item of repoItems.filter((i) => i.slot === 'shoes')) assert.ok(VISUALS[ITEMS[item.id]], item.id);
  for (const el of ['fire', 'wind', 'water', 'holy', 'shadow']) {
    const v = VISUALS[ITEMS[Object.keys(ITEMS).find((k) => k.startsWith(`equip_shoes_${el}_`))]];
    assert.deepEqual(v.files, VISUALS['shoes-peasant'].files, el);
    assert.ok(v.colorize, el);
  }
});

const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-'));
build(out3, 'body-dark-knight,body-handpainted-knight,shoes-ranger,shoes-holy');
const doc3 = await new NodeIO().read(path.join(out3, 'gear-male.glb'));
const male = await readTargetSkeleton('male');
const verts = (name) => { const P = doc3.getRoot().listNodes().find((n) => n.getName() === name).getMesh().listPrimitives()[0].getAttribute('POSITION'); return [...Array(P.getCount()).keys()].map((i) => P.getElement(i, [])); };

test('physical T2/T3: no shin guards — below the knee only a body-hugging legging, down to mid-shin', async () => {
  const { readTargetBody } = await import('../lib/skeleton.mjs');
  const body = await readTargetBody('male');
  const knee = male.pos('calf_l')[1];
  const skin = [];
  for (let v = 0; v < body.count; v++) if (body.positions[v * 3 + 1] < knee + 0.05) skin.push(body.positions.subarray(v * 3, v * 3 + 3));
  for (const v of ['body-dark-knight', 'body-handpainted-knight']) {
    const low = verts(v).filter((p) => p[1] < knee - 0.08);
    assert.ok(low.length > 20, `${v}: no legging`);
    assert.ok(Math.min(...low.map((p) => p[1])) < 0.33, `${v}: legging stops above mid-shin`);
    const far = low.filter((p) => !skin.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.012));
    assert.equal(far.length, 0, `${v}: ${far.length} vertices below the knee stand off the leg (shin guard)`);
    const node = doc3.getRoot().listNodes().find((n) => n.getName() === v);
    const all = verts(v), idx = node.getMesh().listPrimitives()[0].getIndices().getArray();
    const tris = [];
    for (let t = 0; t < idx.length; t += 3) if ([idx[t], idx[t + 1], idx[t + 2]].some((i) => all[i][1] < knee)) tris.push([all[idx[t]], all[idx[t + 1]], all[idx[t + 2]]]);
    const band = skin.filter((p) => p[1] > 0.3 && p[1] < knee - 0.02);
    const covered = band.filter((p) => tris.some((tri) => pointTriangleDistance(p, tri) < 0.004)).length;
    assert.ok(covered / band.length >= 0.98, `${v}: legging covers ${covered}/${band.length}`);
  }
});

test('traveler boots are a real boot: every bit of calf skin up to the shaft lies under the liner (<4 mm)', async () => {
  const { readTargetBody } = await import('../lib/skeleton.mjs');
  const body = await readTargetBody('male');
  const shoe = verts('shoes-ranger');
  const top = Math.max(...shoe.map((p) => p[1])) - 0.05;
  const calfIdx = [male.index.get('calf_l'), male.index.get('calf_r')];
  const dominant = (v) => { let bi = 0; for (let k = 1; k < 4; k++) if (body.weights[v * 4 + k] > body.weights[v * 4 + bi]) bi = k; return body.joints[v * 4 + bi]; };
  const skin = [];
  for (let v = 0; v < body.count; v++) {
    const p = body.positions.subarray(v * 3, v * 3 + 3);
    if (p[1] > 0.15 && p[1] < top - 0.02 && calfIdx.includes(dominant(v))) skin.push(p);
  }
  const prim = doc3.getRoot().listNodes().find((n) => n.getName() === 'shoes-ranger').getMesh().listPrimitives()[0];
  const idx = prim.getIndices().getArray();
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) tris.push([shoe[idx[t]], shoe[idx[t + 1]], shoe[idx[t + 2]]]);
  const covered = skin.filter((p) => tris.some((tri) => pointTriangleDistance(p, tri) < 0.004)).length;
  assert.ok(covered / skin.length >= 0.98, `${covered}/${skin.length}`);
  // the ankle too: no visible skin between the shaft and the foot (the feet region is hidden under any boot)
  const ankle = [];
  for (let v = 0; v < body.count; v++) { const p = body.positions.subarray(v * 3, v * 3 + 3); if (p[1] < 0.2 && calfIdx.includes(dominant(v))) ankle.push(p); }
  const ankleCovered = ankle.filter((p) => tris.some((tri) => pointTriangleDistance(p, tri) < 0.004)).length;
  assert.ok(ankleCovered / ankle.length >= 0.95, `ankle ${ankleCovered}/${ankle.length}`);
});

/** Distance from p to triangle [a, b, c] (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangleDistance(p, [a, b, c]) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const at = (q) => Math.hypot(...sub(p, q));
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

test('shipped atlas keeps the Dark Knight flat colours (regression: lossy WebP turned black armour teal)', async () => {
  const sharp = (await import('sharp')).default;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-'));
  build(out, Object.keys(VISUALS).join(','));
  const doc = await new NodeIO().read(path.join(out, 'gear-male.glb'));
  const prim = doc.getRoot().listNodes().find((n) => n.getName() === 'body-dark-knight').getMesh().listPrimitives()[0];
  const uv = prim.getAttribute('TEXCOORD_0');
  const { data, info } = await sharp(path.join(out, 'gear-atlas.webp')).raw().toBuffer({ resolveWithObject: true });
  const srgb = (c) => Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  // source base colours (linear): hoodie 0.03, metal 0.18/0.17/0.17, leather 0.07/0.04/0.03
  const expected = [[0.03, 0.03, 0.03], [0.18, 0.17, 0.17], [0.07, 0.04, 0.03]].map((c) => c.map(srgb));
  const found = new Set();
  for (let i = 0; i < uv.getCount(); i++) {
    const [u, v] = uv.getElement(i, []);
    const p = (Math.floor(v * info.height) * info.width + Math.floor(u * info.width)) * info.channels;
    const got = [data[p], data[p + 1], data[p + 2]];
    const match = expected.findIndex((e) => e.every((c, k) => Math.abs(c - got[k]) <= 8));
    assert.ok(match >= 0, `colour ${got} matches none of ${JSON.stringify(expected)}`);
    found.add(match);
  }
  assert.equal(found.size, 3);
});

test('holy boots are cream (#cfcaa9 family), not silver-blue', async () => {
  const sharp = (await import('sharp')).default;
  const prim = doc3.getRoot().listNodes().find((n) => n.getName() === 'shoes-holy').getMesh().listPrimitives()[0];
  const uv = prim.getAttribute('TEXCOORD_0');
  const { data, info } = await sharp(path.join(out3, 'gear-atlas.webp')).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < uv.getCount(); i++) { const [u, v] = uv.getElement(i, []); const p = (Math.floor(v * info.height) * info.width + Math.floor(u * info.width)) * info.channels; r += data[p]; g += data[p + 1]; b += data[p + 2]; }
  const n = uv.getCount();
  assert.ok(r / n > b / n + 10 && g / n > b / n, `mean rgb ${(r / n) | 0},${(g / n) | 0},${(b / n) | 0}`);
});

test('a shell hides the skin under it: the manifest carries per-sex hide bands for shells', () => {
  const m = JSON.parse(fs.readFileSync(path.join(out3, 'manifest.json'), 'utf8'));
  for (const v of ['shoes-ranger', 'body-dark-knight']) {
    for (const sex of ['male', 'female']) {
      const bands = m.visuals[v].hide?.[sex];
      assert.ok(Array.isArray(bands) && bands.length, `${v} ${sex}`);
      for (const b of bands) assert.ok(b.region === 'calves' && b.maxY > b.minY, JSON.stringify(b));
    }
  }
  const knee = male.pos('calf_l')[1];
  const legging = m.visuals['body-dark-knight'].hide.male[0];
  assert.ok(legging.maxY <= knee + 0.05 && legging.minY >= 0.2, JSON.stringify(legging));
});

const LENGTH = { dagger: [0.2, 0.42], sword: [0.9, 1.1], greatsword: [1.4, 1.6], bow: [1.2, 1.35], staff: [1.5, 1.75], rod: [0.5, 0.65], shield: [0.6, 0.8], rune: [0.15, 0.32] };
test('weapon mapping requested by the user (2026-11-22)', () => {
  assert.equal(ITEMS.equip_dagger_t1, 'dagger-serrated');
  assert.equal(VISUALS['dagger-serrated'].source, 'weapons:Sword_2');
  assert.equal(ITEMS.equip_dagger_t2, 'dagger-kaykit');
  assert.ok(VISUALS[ITEMS.equip_dagger_t3].smoothBlade);
  assert.equal(VISUALS[ITEMS.equip_sword_t2].source, 'weapons:Claymore');
  assert.match(VISUALS[ITEMS.equip_greatsword_t2].source, /09ef2c4a/);
  assert.equal(ITEMS.equip_staff_t2, 'staff-ancient-gold');
  assert.equal(ITEMS.equip_staff_t3, 'staff-skeleton');
  for (const t of [1, 2, 3]) assert.match(ITEMS[`equip_rune_t${t}`], /^rune-orb/);
  assert.ok(Math.abs(VISUALS[ITEMS.equip_knife].length - 0.8 * 0.28) < 1e-9);
});

test('every hand item has a weapon visual of its type, sized for its type, bows with a BowString', async () => {
  const hands = repoItems.filter((i) => i.slot === 'mainHand' || i.slot === 'offHand');
  assert.equal(hands.length, 25);
  const ids = [...new Set(hands.map((i) => ITEMS[i.id]))];
  for (const item of hands) {
    const v = VISUALS[ITEMS[item.id]];
    assert.ok(v, item.id);
    assert.equal(v.weaponType, item.weaponType, item.id);
    assert.equal(v.slot, item.slot, item.id);
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-'));
  build(out, ids.join(','));
  const doc = await new NodeIO().read(path.join(out, 'gear-rigid.glb'));
  for (const id of ids) {
    const node = doc.getRoot().listNodes().find((n) => n.getName() === id);
    assert.ok(node?.getMesh(), id);
    const { getBounds } = await import('@gltf-transform/core');
    const b = getBounds(node);
    const size = Math.max(...[0, 1, 2].map((k) => b.max[k] - b.min[k]));
    const [lo, hi] = LENGTH[VISUALS[id].weaponType];
    assert.ok(size >= lo && size <= hi, `${id}: ${size.toFixed(2)} m not in [${lo}, ${hi}]`);
    if (VISUALS[id].weaponType === 'bow') assert.ok(node.listChildren().some((c) => c.getName() === 'BowString' && c.getMesh()), `${id}: BowString`);
  }
});
