/**
 * A hand item for a character-rig monster (manifest `weapon`, a gear visual id such as
 * `bow-wooden`, the Yew Bow T1). Loaded on demand by MonsterViewerComponent, so three.js
 * and the gear files stay out of the initial bundle.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HandWeaponType } from '@nanommo/shared';
import { CharacterAssetCache } from '../character-viewer/character-asset-cache';
import { gearMaterial } from '../character-viewer/gear-merge';
import type { LoadedGear } from '../character-viewer/gear-manifest';
import { gripMatrix } from '../character-viewer/grip';
import { measureFist } from '../character-viewer/body-asset';
import { BowShotState, poseBowShot, type HeldBow } from '../character-viewer/bow-shot';

const CHARACTER_ASSETS = '/assets/character/';

export interface MonsterWeapon {
  /** 'bow': the Attack is the procedural draw-and-loose instead of a swing. */
  type: HandWeaponType;
  /** Before the mixer poses a frame: undo the last shot's arm override. */
  restore(): void;
  /** After the mixer: pose the shot at `progress` (0..1 of the Attack window), or rest the string (null). */
  pose(progress: number | null): void;
}

/** The wearable gear (shared with every character viewer on the page). */
export function loadMonsterWeaponGear(): Promise<LoadedGear> {
  const loader = new GLTFLoader();
  return CharacterAssetCache.shared(CHARACTER_ASSETS, (url) => loader.loadAsync(url)).gear();
}

/**
 * Puts gear visual `visualId` in the monster's hand (the bone the gear manifest names),
 * gripped like a character's. `root` must be in its Idle pose (the fist is measured on it).
 */
export function attachMonsterWeapon(root: THREE.Object3D, visualId: string, gear: LoadedGear): MonsterWeapon | null {
  const visual = gear.manifest.visuals[visualId];
  const source = gear.rigid.get(visualId);
  const type = visual?.weaponType as HandWeaponType | undefined;
  if (!visual || !source || !type) return null;
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
  const side: 'right' | 'left' = visual.bone === 'hand_l' ? 'left' : 'right';
  const hand = bones.get(side === 'right' ? 'hand_r' : 'hand_l');
  const fingers = ['index', 'middle', 'ring', 'pinky'].every((f) => bones.has(`${f}_01_${side[0]}`) && bones.has(`${f}_03_${side[0]}`));
  if (!hand || !fingers) return null;

  const item = source.clone(true);
  item.name = `weapon:${visualId}`;
  item.traverse((child) => {
    child.frustumCulled = false;
    if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = gearMaterial(gear);
  });
  root.updateMatrixWorld(true);
  hand.add(item);
  gripMatrix(measureFist(bones, side === 'right' ? 'r' : 'l'), type).decompose(item.position, item.quaternion, item.scale);

  const bow: HeldBow | null = type === 'bow' ? { side, item } : null;
  const shot = new BowShotState();
  return {
    type,
    restore: () => shot.restore(),
    pose: (progress) => { if (bow) poseBowShot(shot, bones, root, bow, progress); },
  };
}
