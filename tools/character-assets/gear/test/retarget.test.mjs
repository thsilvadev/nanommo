import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vec3 } from 'gl-matrix';
import { readTargetSkeleton } from '../lib/skeleton.mjs';
import { normalizeBoneName } from '../lib/bones.mjs';
import { retargetSkinned } from '../lib/retarget.mjs';
import { mixamoDoc } from './fixtures.mjs';

const target = await readTargetSkeleton('male');
const centroid = (prim) => {
  const P = prim.getAttribute('POSITION'); const c = vec3.create();
  for (let i = 0; i < P.getCount(); i++) vec3.add(c, c, P.getElement(i, []));
  return vec3.scale(c, c, 1 / P.getCount());
};
const uniqueJoints = (prim) => {
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'); const s = new Set();
  for (let i = 0; i < J.getCount(); i++) { const j = J.getElement(i, []), w = W.getElement(i, []); for (let k = 0; k < 4; k++) if (w[k] > 0) s.add(j[k]); }
  return [...s];
};

test('normalizeBoneName strips rig prefixes, sketchfab suffixes and .001 duplicates', () => {
  assert.equal(normalizeBoneName('Thigh.R.001_048'), 'thigh.r');
  assert.equal(normalizeBoneName('mixamorig:LeftUpLeg_016'), 'leftupleg');
  assert.equal(normalizeBoneName('bip L UpperArm_08'), 'biplupperarm');
});

test('a quad on a 2x-tall, backwards Mixamo forearm lands on our forearm, weighted to lowerarm_l', () => {
  const { doc, prim } = mixamoDoc(target);
  const { report } = retargetSkinned(doc, target, {});
  assert.equal(report.missing.length, 0);
  const mid = vec3.lerp(vec3.create(), target.pos('lowerarm_l'), target.pos('hand_l'), 0.5);
  assert.ok(vec3.distance(centroid(prim), mid) < 0.03, `centroid ${[...centroid(prim)]} vs ${[...mid]}`);
  assert.deepEqual(uniqueJoints(prim), [target.index.get('lowerarm_l')]);
});

test('a rig without a head is refused', () => {
  const { doc } = mixamoDoc(target, { omit: ['Head'] });
  assert.throws(() => retargetSkinned(doc, target, {}), /missing key bones: Head/);
});

test('a rig already using our bone names maps each bone to itself (spine_02 stays spine_02)', () => {
  const { doc, prim } = mixamoDoc(target, { naming: 'ours', scale: 1, quadBone: 'spine_02', quadTail: 'spine_03' });
  retargetSkinned(doc, target, {});
  assert.deepEqual(uniqueJoints(prim), [target.index.get('spine_02')]);
});
