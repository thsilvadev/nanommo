/**
 * Body instances for the character rigs: the per-instance, mutable part of a
 * character (deformed vertices, repainted skin, its own mixer and bones).
 * Prepared from a clone of the raw glTF that CharacterAssetCache shares.
 */
import * as THREE from 'three';
import type { Sex } from '@nanommo/shared';
import { averageSkinColor, type BodySurface } from './skin-compositor';

export const SKIN_TEXTURE_SIZE = 1024;
/** Background loops, phased by the absolute clock (two views of the same character walk in step). */
export const BASE_CLIPS = ['Idle', 'Walk', 'CombatIdle'] as const;
/** Full-body clips that take over from the loop: actions, casting, death. */
export const OVERLAY_CLIPS = ['Attack', 'Dead', 'CastStart', 'CastLoop'] as const;
/** Flinches, blended over whatever plays. */
export const HIT_CLIPS = ['Damage', 'Damage2'] as const;
export const CLIP_NAMES: string[] = [...BASE_CLIPS, ...OVERLAY_CLIPS, ...HIT_CLIPS];
/** Town-only emotes (/dance, /sit): loaded with the library, played by the town scene, never by the rig. */
export const TOWN_CLIPS = ['Dance', 'SitDown', 'Sit'] as const;
export const LIBRARY_CLIPS: string[] = [...CLIP_NAMES, ...TOWN_CLIPS];
/** Clips authored right-handed (sword arm, casting arm), mirrored for left-handed characters. */
export const MIRRORED_CLIPS = ['Attack', 'CombatIdle', 'CastStart', 'CastLoop'];
export const MIRROR_SAMPLES_PER_SECOND = 30;
export const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;

export interface BodyAsset {
  sex: Sex;
  root: THREE.Object3D;
  body: THREE.SkinnedMesh;
  brows: THREE.SkinnedMesh;
  bones: Map<string, THREE.Bone>;
  /** Bone world matrices in the bind pose, relative to the body root. */
  bind: Map<string, THREE.Matrix4>;
  originalBody: Float32Array;
  originalBrows: Float32Array;
  surface: BodySurface;
  baseSkin: ImageData;
  skinReference: [number, number, number];
  skinCanvas: HTMLCanvasElement;
  skinTexture: THREE.CanvasTexture;
  noseTip: THREE.Vector3;
  chestCenters: THREE.Vector3[];
  /** Face landmarks for the face-shape trait. */
  jaw: THREE.Vector3[];
  chin: THREE.Vector3;
  cheeks: THREE.Vector3[];
  earLobes: THREE.Vector3[];
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  /** One action per clip, all playing; the rig sets their time and weight on every frame. */
  actions: Map<string, THREE.AnimationAction>;
  /** Smoothed (crossfaded) layer weights, before composition. */
  weights: Map<string, number>;
  /** Clock time of the last animated frame; null until the body's first frame (which snaps). */
  animatedAtMs: number | null;
  /** The other handedness of MIRRORED_CLIPS; swapped with `actions` when it is in use. */
  mirrorActions: Map<string, THREE.AnimationAction>;
  /** Whether `actions` currently holds the left-handed (mirrored) variants. */
  mirrored: boolean;
  /** Closed-fist frame of each hand in the Idle pose, in hand-bone space. */
  fists: Record<'right' | 'left', Fist>;
  deformKey: string;
  skinKey: string;
}

export interface Fist {
  /** Centre of the hole formed by the curled fingers. */
  centre: THREE.Vector3;
  /** Along the hole, towards the index/thumb side. */
  lateral: THREE.Vector3;
  /** From the wrist towards the knuckles. */
  along: THREE.Vector3;
  /** Towards the palm (where the fingers curl). */
  palm: THREE.Vector3;
}

export function prepareBody(sex: Sex, root: THREE.Object3D, sourceClips: THREE.AnimationClip[], pelvisRest: number): BodyAsset {
  root.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Bone>();
  const bind = new Map<string, THREE.Matrix4>();
  let body: THREE.SkinnedMesh | null = null;
  let brows: THREE.SkinnedMesh | null = null;
  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) { bones.set(child.name, child as THREE.Bone); bind.set(child.name, child.matrixWorld.clone()); }
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      const mesh = child as THREE.SkinnedMesh;
      mesh.frustumCulled = false;
      if (child.name === 'Body') body = mesh;
      if (child.name === 'Brows') brows = mesh;
    }
  });
  if (!body || !brows) throw new Error(`body-${sex}.glb has no Body/Brows mesh`);
  const bodyMesh: THREE.SkinnedMesh = body;
  const browsMesh: THREE.SkinnedMesh = brows;
  deinterleave(bodyMesh.geometry);
  deinterleave(browsMesh.geometry);
  markLashes(browsMesh, root);

  const geometry = bodyMesh.geometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const originalBody = new Float32Array(position.array as ArrayLike<number>);
  const originalBrows = new Float32Array((browsMesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>);
  const surface: BodySurface = { positions: originalBody, normals: normal.array as ArrayLike<number>, uvs: uv.array as ArrayLike<number>, index: geometry.index?.array as ArrayLike<number> ?? null };

  // Landmarks found on the mesh itself, so both bodies need no hand-tuned coordinates.
  const top = geometry.boundingBox?.max.y ?? (geometry.computeBoundingBox(), geometry.boundingBox!.max.y);
  const noseTip = new THREE.Vector3(0, 0, -Infinity);
  const chest = [new THREE.Vector3(0, 0, -Infinity), new THREE.Vector3(0, 0, -Infinity)];
  const ears = [new THREE.Vector3(-Infinity, 0, 0), new THREE.Vector3(Infinity, 0, 0)];
  const spine = bind.get('spine_03')!, neck = bind.get('neck_01')!;
  const chestLow = spine.elements[13], chestHigh = neck.elements[13];
  for (let i = 0; i < position.count; i++) {
    const x = originalBody[i * 3], y = originalBody[i * 3 + 1], z = originalBody[i * 3 + 2];
    if (Math.abs(x) < 0.02 && y > top - 0.25 && y < top - 0.08 && z > noseTip.z) noseTip.set(x, y, z);
    const ax = Math.abs(x);
    if (ax > 0.04 && ax < 0.17 && y > chestLow && y < chestHigh && normal.getZ(i) > 0.5) {
      const side = x > 0 ? 0 : 1;
      if (z > chest[side].z) chest[side].set(x, y, z);
    }
  }
  const jaw = [new THREE.Vector3(-Infinity, 0, 0), new THREE.Vector3(Infinity, 0, 0)];
  const chin = new THREE.Vector3(0, 0, -Infinity);
  const cheeks = [new THREE.Vector3(0, 0, -Infinity), new THREE.Vector3(0, 0, -Infinity)];
  for (let i = 0; i < position.count; i++) {
    const x = originalBody[i * 3], y = originalBody[i * 3 + 1], z = originalBody[i * 3 + 2];
    const dy = y - noseTip.y, dz = z - noseTip.z;
    if (dy > -0.075 && dy < -0.045 && dz > -0.12 && dz < -0.06) {
      if (x > jaw[0].x) jaw[0].set(x, y, z);
      if (x < jaw[1].x) jaw[1].set(x, y, z);
    }
    if (Math.abs(x) < 0.01 && dy > -0.075 && dy < -0.055 && z > chin.z) chin.set(x, y, z);
    if (Math.abs(Math.abs(x) - 0.045) < 0.008 && Math.abs(dy + 0.008) < 0.01 && normal.getZ(i) > 0.3) {
      const side = x > 0 ? 0 : 1;
      if (z > cheeks[side].z) cheeks[side].set(x, y, z);
    }
  }
  for (let i = 0; i < position.count; i++) {
    const x = originalBody[i * 3], y = originalBody[i * 3 + 1], z = originalBody[i * 3 + 2];
    if (y > noseTip.y && y < noseTip.y + 0.03 && Math.abs(z) < 0.06) {
      if (x > ears[0].x) ears[0].set(x, y, z);
      if (x < ears[1].x) ears[1].set(x, y, z);
    }
  }

  const material = bodyMesh.material as THREE.MeshStandardMaterial;
  const baseImage = material.map!.image as CanvasImageSource & { width: number; height: number };
  const skinCanvas = document.createElement('canvas');
  skinCanvas.width = skinCanvas.height = SKIN_TEXTURE_SIZE;
  const ctx = skinCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(baseImage, 0, 0, SKIN_TEXTURE_SIZE, SKIN_TEXTURE_SIZE);
  const baseSkin = ctx.getImageData(0, 0, SKIN_TEXTURE_SIZE, SKIN_TEXTURE_SIZE);
  const skinTexture = new THREE.CanvasTexture(skinCanvas);
  skinTexture.flipY = false;
  skinTexture.colorSpace = THREE.SRGBColorSpace;
  skinTexture.anisotropy = 4;
  // The original map belongs to the shared raw glTF (CharacterAssetCache): never dispose it here.
  material.map = skinTexture;
  material.needsUpdate = true;

  // The library's clips carry the mannequin's pelvis height; rescale it to this body.
  const pelvis = bones.get('pelvis');
  const mixer = new THREE.AnimationMixer(root);
  const clips = sourceClips.map((source) => {
    const clip = source.clone();
    const ratio = (pelvis?.position.length() ?? 1) / pelvisRest;
    for (const track of clip.tracks) {
      if (track.name === 'pelvis.position') for (let i = 0; i < track.values.length; i++) track.values[i] *= ratio;
    }
    return clip;
  });
  // Left-handed variants of the clips that favour one hand (sampled before the mixer binds anything).
  const mirrorSources = clips.filter((clip) => MIRRORED_CLIPS.includes(clip.name)).map((clip) => mirrorClip(clip, root, bones));
  // Every clip plays all the time at time scale 0: the rig positions each one by the
  // clock and decides its weight, so the mixer never advances anything by itself.
  const makeAction = (clip: THREE.AnimationClip) => {
    const action = mixer.clipAction(clip);
    if (!(BASE_CLIPS as readonly string[]).includes(clip.name)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true; // Dead (and every one-shot) holds its last frame
    }
    action.timeScale = 0;
    action.setEffectiveWeight(clip.name === 'Idle' ? 1 : 0);
    action.play();
    return action;
  };
  const actions = new Map<string, THREE.AnimationAction>(clips.filter((clip) => CLIP_NAMES.includes(clip.name)).map((clip) => [clip.name, makeAction(clip)]));
  const mirrorActions = new Map<string, THREE.AnimationAction>(mirrorSources.map((clip) => [clip.name, makeAction(clip)]));
  for (const action of mirrorActions.values()) action.setEffectiveWeight(0);

  // Measure the closed fist in the Idle pose (in the bind pose the fingers are straight).
  mixer.update(0);
  root.updateMatrixWorld(true);
  const fists = { right: measureFist(bones, 'r'), left: measureFist(bones, 'l') };

  return {
    sex, root, body: bodyMesh, brows: browsMesh, bones, bind, originalBody, originalBrows, surface,
    baseSkin, skinReference: averageSkinColor(baseSkin.data), skinCanvas, skinTexture,
    noseTip, chestCenters: chest, jaw, chin, cheeks, earLobes: ears, mixer, clips, actions, mirrorActions, mirrored: false,
    weights: new Map(CLIP_NAMES.map((name) => [name, name === 'Idle' ? 1 : 0])), animatedAtMs: null,
    fists, deformKey: '', skinKey: '',
  };
}

/**
 * Left-right mirror of a clip. Each frame is sampled on the body, every bone's rotation
 * relative to its rest pose is reflected across the body's midplane (x = 0) and given to
 * its counterpart (`_l` <-> `_r`), then turned back into local rotations. Working in body
 * space keeps it independent of the bones' axis conventions; it relies on the rest pose
 * being symmetric, which holds for both bodies. Must run before the body's own mixer
 * binds the bones; the sampled pose is undone afterwards.
 */
function mirrorClip(clip: THREE.AnimationClip, root: THREE.Object3D, bones: Map<string, THREE.Bone>): THREE.AnimationClip {
  const counterpart = (name: string) => (name.endsWith('_l') ? `${name.slice(0, -2)}_r` : name.endsWith('_r') ? `${name.slice(0, -2)}_l` : name);
  const list = [...bones.values()];
  const rest = list.map((bone) => [bone.quaternion.clone(), bone.position.clone()] as const);
  root.updateMatrixWorld(true);
  const rootInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const inBody = (object: THREE.Object3D) => rootInverse.clone().multiply(object.getWorldQuaternion(new THREE.Quaternion()));
  const restInBody = new Map(list.map((bone) => [bone.name, inBody(bone)]));
  const animated = new Set(clip.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => t.name.slice(0, -'.quaternion'.length)));
  const targets = list.filter((bone) => animated.has(counterpart(bone.name)));
  const pelvis = bones.get('pelvis');
  const movesPelvis = !!pelvis && clip.tracks.some((t) => t.name === 'pelvis.position');

  const sampler = new THREE.AnimationMixer(root);
  const action = sampler.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const count = Math.max(2, Math.ceil(clip.duration * MIRROR_SAMPLES_PER_SECOND) + 1);
  const times = new Float32Array(count);
  const rotations = new Map(targets.map((bone) => [bone.name, new Float32Array(count * 4)]));
  const pelvisPositions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    times[i] = Math.min(clip.duration, i / MIRROR_SAMPLES_PER_SECOND);
    action.time = times[i];
    sampler.update(0);
    root.updateMatrixWorld(true);
    const mirrored = new Map<string, THREE.Quaternion>();
    for (const bone of list) {
      const source = bones.get(counterpart(bone.name)) ?? bone;
      const delta = inBody(source).multiply(restInBody.get(source.name)!.clone().invert());
      // Reflection across x = 0: the rotation axis (a pseudovector) keeps x and flips y and z.
      mirrored.set(bone.name, new THREE.Quaternion(delta.x, -delta.y, -delta.z, delta.w).multiply(restInBody.get(bone.name)!));
    }
    for (const bone of targets) {
      const parent = bone.parent!;
      const parentInBody = (parent as THREE.Bone).isBone ? mirrored.get(parent.name)! : inBody(parent);
      parentInBody.clone().invert().multiply(mirrored.get(bone.name)!).toArray(rotations.get(bone.name)!, i * 4);
    }
    if (movesPelvis) {
      const position = root.worldToLocal(pelvis!.getWorldPosition(new THREE.Vector3()));
      position.x = -position.x;
      pelvis!.parent!.worldToLocal(root.localToWorld(position)).toArray(pelvisPositions, i * 3);
    }
  }
  sampler.stopAllAction();
  sampler.uncacheRoot(root);
  list.forEach((bone, i) => { bone.quaternion.copy(rest[i][0]); bone.position.copy(rest[i][1]); });
  root.updateMatrixWorld(true);

  const tracks: THREE.KeyframeTrack[] = targets.map((bone) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations.get(bone.name)!));
  if (movesPelvis) tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pelvisPositions));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Closed-fist frame of one hand, from its finger bones in the current pose, in hand-bone space. */
export function measureFist(bones: Map<string, THREE.Bone>, side: 'r' | 'l'): Fist {
  const hand = bones.get(`hand_${side}`)!;
  const local = (name: string) => hand.worldToLocal(new THREE.Vector3().setFromMatrixPosition(bones.get(`${name}_${side}`)!.matrixWorld));
  const average = (names: string[]) => names.map(local).reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(names.length);
  const knuckles = average(FINGERS.map((f) => `${f}_01`));
  const tips = average(FINGERS.map((f) => `${f}_03`));
  const along = knuckles.clone().normalize();
  const lateral = local('index_01').sub(local('pinky_01'));
  lateral.addScaledVector(along, -lateral.dot(along)).normalize();
  const palm = tips.clone().sub(knuckles);
  palm.addScaledVector(along, -palm.dot(along)).addScaledVector(lateral, -palm.dot(lateral)).normalize();
  return { centre: knuckles.clone().add(tips).multiplyScalar(0.5), lateral, along, palm };
}

/**
 * The brow mesh also holds the eyelashes/eyeliner. Vertices close to an eye get
 * a dark vertex colour so only the brows take the hair colour.
 */
function markLashes(brows: THREE.SkinnedMesh, root: THREE.Object3D): void {
  const eyes = root.getObjectByName('Eyes') as THREE.Mesh | undefined;
  const centres = [new THREE.Vector3(), new THREE.Vector3()];
  const counts = [0, 0];
  const eyePosition = eyes?.geometry.getAttribute('position');
  if (eyePosition) {
    for (let i = 0; i < eyePosition.count; i++) {
      const side = eyePosition.getX(i) > 0 ? 0 : 1;
      centres[side].x += eyePosition.getX(i); centres[side].y += eyePosition.getY(i); centres[side].z += eyePosition.getZ(i);
      counts[side]++;
    }
    centres.forEach((centre, side) => centre.divideScalar(Math.max(1, counts[side])));
  }
  const position = brows.geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const nearEye = !!eyePosition && Math.min(p.distanceTo(centres[0]), p.distanceTo(centres[1])) < 0.019;
    colors.fill(nearEye ? 0.12 : 1, i * 3, i * 3 + 3);
  }
  brows.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  (brows.material as THREE.MeshStandardMaterial).vertexColors = true;
  (brows.material as THREE.MeshStandardMaterial).needsUpdate = true;
}

/** The appearance code reads and rewrites vertex arrays directly, which needs one plain array per attribute. */
export function deinterleave(geometry: THREE.BufferGeometry): void {
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if ((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      const source = attribute as THREE.InterleavedBufferAttribute;
      const plain = new THREE.BufferAttribute(new Float32Array(source.count * source.itemSize), source.itemSize, source.normalized);
      for (let i = 0; i < source.count; i++) {
        for (let c = 0; c < source.itemSize; c++) plain.setComponent(i, c, source.getComponent(i, c));
      }
      geometry.setAttribute(name, plain);
    }
  }
}
