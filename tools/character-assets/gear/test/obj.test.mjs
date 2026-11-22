import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readObj } from '../lib/obj.mjs';

test('an OBJ with two materials becomes one node, one primitive per material, colours from the .mtl (linear)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obj-'));
  fs.writeFileSync(path.join(dir, 'w.mtl'), 'newmtl Wood\nKd 0.5 0.25 0.1\nnewmtl White\nKd 1 1 1\n');
  fs.writeFileSync(path.join(dir, 'w.obj'), 'mtllib w.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nusemtl Wood\nf 1 2 3 4\nusemtl White\nf 1 2 3\n');
  const doc = readObj(path.join(dir, 'w.obj'), 'Bow');
  const node = doc.getRoot().listNodes().find((n) => n.getName() === 'Bow');
  const prims = node.getMesh().listPrimitives();
  assert.deepEqual(prims.map((p) => p.getMaterial().getName()), ['Wood', 'White']);
  assert.equal(prims[0].getIndices()?.getCount() ?? prims[0].getAttribute('POSITION').getCount(), 6); // quad fan -> 2 triangles
  assert.deepEqual(prims[0].getMaterial().getBaseColorFactor(), [0.5, 0.25, 0.1, 1]);
  assert.ok(prims[0].getAttribute('NORMAL'));
});
