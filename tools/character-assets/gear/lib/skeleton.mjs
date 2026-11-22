/** Our target skeleton (body-<sex>.glb, 65 UE-named joints, T-pose rest) and writing it into other documents. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { mat4, vec3, quat } from 'gl-matrix';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHARACTER_ASSETS = path.resolve(here, '../../../../apps/frontend/public/assets/character');

/**
 * @typedef {{ name: string, parent: string|null, local: {t: number[], r: number[], s: number[]}, world: mat4, ibm: mat4 }} TargetJoint
 * @typedef {{ sex: string, joints: TargetJoint[], index: Map<string, number>, pos: (name: string) => vec3 }} Target
 */

/** @returns {Promise<Target>} */
export async function readTargetSkeleton(sex) {
  const doc = await new NodeIO().read(path.join(CHARACTER_ASSETS, `body-${sex}.glb`));
  const skin = doc.getRoot().listSkins()[0];
  const nodes = skin.listJoints();
  const inSkin = new Set(nodes);
  const ibms = skin.getInverseBindMatrices();
  const joints = nodes.map((node, i) => {
    const parent = node.getParentNode();
    return {
      name: node.getName(),
      parent: parent && inSkin.has(parent) ? parent.getName() : null,
      local: { t: node.getTranslation(), r: node.getRotation(), s: node.getScale() },
      world: mat4.clone(node.getWorldMatrix()),
      ibm: mat4.clone(ibms.getElement(i, [])),
    };
  });
  const index = new Map(joints.map((j, i) => [j.name, i]));
  const pos = (name) => mat4.getTranslation(vec3.create(), joints[index.get(name)].world);
  return { sex, joints, index, pos };
}

/** Our joints as nodes of `doc` (same order as the body's skin) and a skin over them. */
export function writeSkeleton(doc, target) {
  const scene = doc.getRoot().listScenes()[0] ?? doc.createScene();
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const made = new Map();
  let root = null;
  for (const j of target.joints) {
    const node = doc.createNode(j.name);
    if (j.parent && made.has(j.parent)) {
      node.setTranslation(j.local.t).setRotation(j.local.r).setScale(j.local.s);
      made.get(j.parent).addChild(node);
    } else {
      node.setTranslation([...mat4.getTranslation(vec3.create(), j.world)])
        .setRotation([...mat4.getRotation(quat.create(), j.world)])
        .setScale([...mat4.getScaling(vec3.create(), j.world)]);
      scene.addChild(node);
      root ??= node;
    }
    made.set(j.name, node);
  }
  const ibm = new Float32Array(target.joints.length * 16);
  target.joints.forEach((j, i) => ibm.set(j.ibm, i * 16));
  const skin = doc.createSkin('Gear').setSkeleton(root)
    .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  for (const j of target.joints) skin.addJoint(made.get(j.name));
  return { skin, root, nodes: made };
}
