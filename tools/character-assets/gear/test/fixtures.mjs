/** Synthetic glTF documents for the gear pipeline tests (built in memory, no source packs needed). */
import { Document } from '@gltf-transform/core';
import { mat4 } from 'gl-matrix';

/** Mixamo name for each of our bones (only the ones a typical Mixamo rig has). */
export const MIXAMO = {
  pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', Head: 'Head',
  clavicle_l: 'LeftShoulder', upperarm_l: 'LeftArm', lowerarm_l: 'LeftForeArm', hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder', upperarm_r: 'RightArm', lowerarm_r: 'RightForeArm', hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg', calf_l: 'LeftLeg', foot_l: 'LeftFoot', ball_l: 'LeftToeBase',
  thigh_r: 'RightUpLeg', calf_r: 'RightLeg', foot_r: 'RightFoot', ball_r: 'RightToeBase',
};

/**
 * A Mixamo-named rig built from our target skeleton's joint positions, scaled by `scale`
 * and turned 180° about Y (facing -Z), with one quad skinned 100% to `quadBone` placed at
 * the middle of that bone's segment. `omit` leaves bones out (e.g. 'Head').
 */
export function mixamoDoc(target, { scale = 2, omit = [], quadBone = 'lowerarm_l', quadTail = 'hand_l' } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const flip = (p) => [-p[0] * scale, p[1] * scale, -p[2] * scale];
  const nodes = new Map();
  const world = new Map();
  const ours = Object.keys(MIXAMO).filter((t) => !omit.includes(t) && !omit.includes(MIXAMO[t]));
  let n = 0;
  for (const t of target.joints.map((j) => j.name)) {
    if (!ours.includes(t)) continue;
    // parent = nearest kept ancestor in our hierarchy
    let p = target.joints[target.index.get(t)].parent;
    while (p && !ours.includes(p)) p = target.joints[target.index.get(p)].parent;
    const w = flip(target.pos(t));
    const pw = p ? world.get(p) : [0, 0, 0];
    const node = doc.createNode(`mixamorig:${MIXAMO[t]}_${String(n++).padStart(2, '0')}`).setTranslation([w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]]);
    (p ? nodes.get(p) : scene).addChild(node);
    nodes.set(t, node);
    world.set(t, w);
  }
  const joints = [...nodes.values()];
  const skin = doc.createSkin();
  const ibm = new Float32Array(joints.length * 16);
  [...nodes.keys()].forEach((t, i) => {
    skin.addJoint(nodes.get(t));
    ibm.set(mat4.invert(mat4.create(), mat4.fromTranslation(mat4.create(), world.get(t))), i * 16);
  });
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  const a = flip(target.pos(quadBone)), b = flip(target.pos(quadTail));
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const s = 0.02 * scale;
  const pos = new Float32Array([m[0], m[1] - s, m[2] - s, m[0], m[1] + s, m[2] - s, m[0], m[1] + s, m[2] + s, m[0], m[1] - s, m[2] + s]);
  const ji = [...nodes.keys()].indexOf(quadBone);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0])).setBuffer(buffer))
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(16).map((_, i) => (i % 4 === 0 ? ji : 0))).setBuffer(buffer))
    .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(16).map((_, i) => (i % 4 === 0 ? 1 : 0))).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer));
  const meshNode = doc.createNode('Quad').setMesh(doc.createMesh('Quad').addPrimitive(prim)).setSkin(skin);
  scene.addChild(meshNode);
  return { doc, prim };
}

/** Triangles as a primitive with explicit positions (no skin): for region/filter tests. */
export function trianglesDoc(positions, indices) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer));
  doc.createMesh().addPrimitive(prim);
  return { doc, prim };
}
