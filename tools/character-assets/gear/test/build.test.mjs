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

test('user mapping (2026-11-22): green Ranger hood is magic T1, red rogue hood is physical T1', () => {
  assert.equal(ITEMS.equip_head_magic_t1, 'head-ranger-hood');
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
build(out3, 'body-dark-knight,body-handpainted-knight,shoes-ranger');
const doc3 = await new NodeIO().read(path.join(out3, 'gear-male.glb'));
const male = await readTargetSkeleton('male');
const verts = (name) => { const P = doc3.getRoot().listNodes().find((n) => n.getName() === name).getMesh().listPrimitives()[0].getAttribute('POSITION'); return [...Array(P.getCount()).keys()].map((i) => P.getElement(i, [])); };

test('physical T2/T3 bodies stop at the knee (no shin guards)', () => {
  const knee = male.pos('calf_l')[1];
  for (const v of ['body-dark-knight', 'body-handpainted-knight']) {
    const low = verts(v).filter((p) => p[1] < knee - 0.08).length;
    assert.equal(low, 0, `${v}: ${low} vertices below the knee`);
  }
});

test('traveler boots close the back of the calf (leather liner): >=90% of back-calf skin under 1.2 cm of boot', async () => {
  const { readTargetBody } = await import('../lib/skeleton.mjs');
  const body = await readTargetBody('male');
  const shoe = verts('shoes-ranger');
  const top = Math.max(...shoe.map((p) => p[1])) - 0.05;
  const calfZ = male.pos('calf_l')[2];
  const skin = [];
  for (let v = 0; v < body.count; v++) {
    const p = body.positions.subarray(v * 3, v * 3 + 3);
    if (p[1] > 0.15 && p[1] < top && p[2] < calfZ - 0.02 && Math.abs(p[0]) > 0.04) skin.push(p);
  }
  const prim = doc3.getRoot().listNodes().find((n) => n.getName() === 'shoes-ranger').getMesh().listPrimitives()[0];
  const idx = prim.getIndices().getArray();
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) tris.push([shoe[idx[t]], shoe[idx[t + 1]], shoe[idx[t + 2]]]);
  const covered = skin.filter((p) => tris.some((tri) => pointTriangleDistance(p, tri) < 0.012)).length;
  assert.ok(covered / skin.length >= 0.9, `${covered}/${skin.length}`);
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
