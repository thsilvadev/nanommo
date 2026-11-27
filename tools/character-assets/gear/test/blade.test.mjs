import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveBlade, smoothBladeEdge, stretchBlade } from '../lib/blade.mjs';

test('notches on a blade edge are filled up to the profile hull; the spine (x≈0) and the grip (y<0) stay', () => {
  // half-width profile of a blade along +Y: straight 0.1 wide, with a notch at y=0.5 (x=0.05), tip at y=1
  const pts = [[0.1, 0, 0.02], [0.1, 0.4, 0.02], [0.05, 0.5, 0.02], [0.1, 0.6, 0.02], [0, 1, 0], [-0.1, 0.3, 0], [-0.04, 0.55, 0], [-0.1, 0.8, 0], [0, 0.5, 0.03], [0.03, -0.2, 0]];
  const positions = new Float32Array(pts.flat());
  smoothBladeEdge(positions, () => true);
  const at = (i) => [...positions.slice(i * 3, i * 3 + 3)].map((x) => +x.toFixed(4));
  assert.deepEqual(at(2), [0.1, 0.5, 0.02]);      // notch filled
  assert.ok(Math.abs(at(6)[0] + 0.1) < 0.005);    // other side's notch filled (hull between 0.3 and 0.8)
  assert.deepEqual(at(8), [0, 0.5, 0.03]);        // spine untouched
  assert.deepEqual(at(9), [0.03, -0.2, 0]);       // grip untouched
});

test('stretchBlade lengthens only what lies above the guard, along the blade (y); width and grip stay', () => {
  // guard at y=0.4: a grip point, a guard point, a blade root and the tip
  const positions = new Float32Array([0.02, 0.1, 0.01, 0.12, 0.4, 0, 0.06, 0.5, 0.01, 0, 1.4, 0]);
  stretchBlade(positions, 0.4, 1.5);
  const at = (i) => [...positions.slice(i * 3, i * 3 + 3)].map((x) => +x.toFixed(4));
  assert.deepEqual(at(0), [0.02, 0.1, 0.01]);   // grip untouched
  assert.deepEqual(at(1), [0.12, 0.4, 0]);      // guard stays where it is
  assert.deepEqual(at(2), [0.06, 0.55, 0.01]);  // blade root: 0.4 + 0.1 x 1.5, same width
  assert.deepEqual(at(3), [0, 1.9, 0]);         // tip: 0.4 + 1.0 x 1.5
});

test('curveBlade bends within the blade plane (its wider axis) towards the thicker side (the spine); the grip stays', () => {
  // Width along Z (0.05 wide), thin along X. The spine (+z) is 0.02 thick in x, the edge (-z) 0.002. 1 m above the guard.
  const blade = new Float32Array([0.01, 0.5, 0.02, -0.01, 0.5, 0.02, 0.001, 0.5, -0.03, -0.001, 0.5, -0.03, 0, 1, 0]);
  const grip = new Float32Array([0.01, -0.2, 0, -0.01, -0.2, 0]);
  assert.deepEqual(curveBlade([blade, grip], 0, 0.08), { axis: 2, side: 1 });
  const z = (i) => +blade[i * 3 + 2].toFixed(5), x = (i) => +blade[i * 3].toFixed(5);
  assert.equal(z(4), 0.08);                          // tip: full sagitta, along the width
  assert.equal(z(0), +(0.02 + 0.08 * 0.25).toFixed(5)); // halfway: t² = 0.25
  assert.equal(z(2), +(-0.03 + 0.08 * 0.25).toFixed(5)); // the whole cross-section moves together
  assert.deepEqual([0, 1, 2, 3, 4].map(x), [0.01, -0.01, 0.001, -0.001, 0]); // thickness axis untouched
  assert.deepEqual([...grip], [...new Float32Array([0.01, -0.2, 0, -0.01, -0.2, 0])]); // grip untouched
  assert.equal(curveBlade([new Float32Array([0, -1, 0])], 0, 0.1), null);
  const forced = new Float32Array([0.01, 0.5, 0.02, 0, 1, 0]);
  assert.deepEqual(curveBlade([forced], 0, 0.08, -1), { axis: 2, side: -1 });
  assert.equal(+forced[5].toFixed(5), -0.08);
});
