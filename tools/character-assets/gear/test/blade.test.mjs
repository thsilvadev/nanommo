import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothBladeEdge } from '../lib/blade.mjs';

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
