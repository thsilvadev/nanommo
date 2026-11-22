import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION_OF_BONE, filterTriangles, strayFilter } from '../lib/regions.mjs';
import { trianglesDoc } from './fixtures.mjs';

test('bones map to body regions', () => {
  assert.equal(REGION_OF_BONE('middle_02_l'), 'hands');
  assert.equal(REGION_OF_BONE('ball_leaf_r'), 'feet');
  assert.equal(REGION_OF_BONE('clavicle_r'), 'torso');
  assert.equal(REGION_OF_BONE('neck_01'), 'neck');
  assert.equal(REGION_OF_BONE('Head'), 'head');
  assert.equal(REGION_OF_BONE('lowerarm_l'), 'forearms');
});

test('the stray filter drops only the triangle with a vertex far above the body', () => {
  const positions = [0, 1, 0, 0.1, 1, 0, 0, 1.1, 0, /* stray */ 0, 3, 0];
  const { prim } = trianglesDoc(positions, [0, 1, 2, 0, 1, 3]);
  const kept = filterTriangles(prim, strayFilter(new Float32Array(positions)));
  assert.equal(kept, 1);
  assert.deepEqual([...prim.getIndices().getArray()], [0, 1, 2]);
});
