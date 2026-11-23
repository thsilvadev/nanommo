/** Humanoid monsters moved onto OUR character skeleton (they play the character animation library at runtime). */
import { readTargetSkeleton, writeSkeleton } from '../../character-assets/gear/lib/skeleton.mjs';
import { retargetSkinned } from '../../character-assets/gear/lib/retarget.mjs';
import { autoskinStatic } from '../../character-assets/gear/lib/autoskin.mjs';
import { restBounds } from './native.mjs';

/** Source bone base name (suffix _NN stripped) -> our bone, for rigs the gear alias table does not know. */
const sided = (pairs, swap = false) => Object.fromEntries(pairs.flatMap(([src, ours]) => [[src('L', 'Left'), `${ours}_${swap ? 'r' : 'l'}`], [src('R', 'Right'), `${ours}_${swap ? 'l' : 'r'}`]]));
export const BONE_MAPS = {
  treeman: { hip: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head',
    ...sided([[(s) => `${s}_shoulder`, 'clavicle'], [(s) => `${s}_arm`, 'upperarm'], [(s) => `${s}_elbow`, 'lowerarm'], [(s) => `${s}_wrist`, 'hand'],
      [(s) => `${s}_leg`, 'thigh'], [(s) => `${s}_knee`, 'calf'], [(s) => `${s}_foot`, 'foot']]) },
  plague: { b_Pelvis: 'pelvis', b_Belly: 'spine_01', b_Chest: 'spine_03', b_Neck: 'neck_01', b_Face: 'Head',
    ...sided([[(s, w) => `b_Shoulder_${w}`, 'clavicle'], [(s, w) => `b_Arm_Upper_${w}`, 'upperarm'], [(s, w) => `b_Arm_Lower_${w}`, 'lowerarm'],
      [(s, w) => `b_Hand_${w}`, 'hand'], [(s, w) => `b_Leg_${w}_Upper`, 'thigh'], [(s, w) => `b_Leg_${w}_Lower`, 'calf'], [(s, w) => `b_Foot_${w}`, 'foot']], true),
    b_Leg_rIGHT_Upper: 'thigh_l' },
};

export async function buildCharacter(doc, id, cfg) {
  const root = doc.getRoot();
  const target = await readTargetSkeleton(cfg.sex);
  if (cfg.boneMap) {
    const map = BONE_MAPS[cfg.boneMap];
    for (const n of root.listNodes()) { const base = n.getName().replace(/_\d+$/, ''); if (map[base]) n.setName(map[base]); }
  }
  for (const a of root.listAnimations()) { for (const x of a.listSamplers()) x.dispose(); for (const x of a.listChannels()) x.dispose(); a.dispose(); }
  const result = cfg.method === 'autoskin'
    ? await autoskinStatic(doc, target, cfg.autoskin ?? {})
    : retargetSkinned(doc, target, { scale: cfg.retargetScale ?? {} });
  const keep = new Set(result.primitives);

  const meshes = new Set();
  for (const n of root.listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue;
    for (const p of mesh.listPrimitives()) if (!keep.has(p)) mesh.removePrimitive(p);
    if (mesh.listPrimitives().length) meshes.add(mesh);
  }
  const scene = root.listScenes()[0];
  for (const n of scene.listChildren()) scene.removeChild(n);
  for (const s of root.listSkins()) s.dispose();
  for (const n of root.listNodes()) n.dispose();

  const { skin, root: skelRoot } = writeSkeleton(doc, target);
  const k = cfg.scale ?? 1;
  const top = doc.createNode('Monster').setScale([k, k, k]);
  scene.removeChild(skelRoot); top.addChild(skelRoot); scene.addChild(top);
  for (const mesh of meshes) scene.addChild(doc.createNode(mesh.getName() || 'Body').setMesh(mesh).setSkin(skin));
  const { min, max } = restBounds(doc);
  return { height: +(max[1] - min[1]).toFixed(2), clips: ['character'], generated: [] };
}
