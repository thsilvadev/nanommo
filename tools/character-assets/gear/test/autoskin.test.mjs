import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mat4, vec3 } from 'gl-matrix';
import { readTargetSkeleton } from '../lib/skeleton.mjs';
import { autoskinStatic } from '../lib/autoskin.mjs';
import { boxDoc } from './fixtures.mjs';

const target = await readTargetSkeleton('male');
const forearmMid = vec3.lerp(vec3.create(), target.pos('lowerarm_l'), target.pos('hand_l'), 0.5);
const centroid = (P) => { const c = vec3.create(); for (let i = 0; i < P.getCount(); i++) vec3.add(c, c, P.getElement(i, [])); return vec3.scale(c, c, 1 / P.getCount()); };

test('a box over our forearm (T-pose) is weighted to lowerarm_l', async () => {
  const { doc, prim } = boxDoc(forearmMid, [0.02, 0.02, 0.02]);
  const { dominant } = await autoskinStatic(doc, target, { fit: false });
  const dom = dominant.get(prim);
  const hits = [...dom].filter((j) => j === target.index.get('lowerarm_l')).length;
  assert.ok(hits / dom.length >= 0.9, `${hits}/${dom.length}`);
});

test('a box over the forearm of an A-pose (arms 60° down) un-poses back onto the T-pose forearm', async () => {
  const pivot = target.pos('upperarm_l');
  const R = mat4.create();
  mat4.translate(R, R, pivot); mat4.rotateZ(R, R, (-60 * Math.PI) / 180); mat4.translate(R, R, vec3.negate(vec3.create(), pivot));
  const lowered = vec3.transformMat4(vec3.create(), forearmMid, R);
  const { doc, prim } = boxDoc(lowered, [0.02, 0.02, 0.02]);
  await autoskinStatic(doc, target, { fit: false, armDeg: 60 });
  const c = centroid(prim.getAttribute('POSITION'));
  assert.ok(vec3.distance(c, forearmMid) < 0.04, `${[...c]} vs ${[...forearmMid]}`);
});
