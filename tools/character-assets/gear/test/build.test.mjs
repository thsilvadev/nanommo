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
