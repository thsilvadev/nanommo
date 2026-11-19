/**
 * Is an NPC hidden by the town itself, seen from the fixed town camera?
 * Pure geometry over the built world (no WebGL): rays leave sample points on the
 * NPC's body towards the camera and must not hit any obstacle mesh.
 */
import * as THREE from 'three';
import { TOWN_CAMERA_MIN_DISTANCE, TOWN_CAMERA_PITCH_DEG, TOWN_CAMERA_YAW_DEG } from './town-camera';

const PITCH = (TOWN_CAMERA_PITCH_DEG * Math.PI) / 180;
const YAW = (TOWN_CAMERA_YAW_DEG * Math.PI) / 180;
/** From the target towards the camera (same as TownCamera). */
export const TOWN_TO_CAMERA = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)).normalize();
/** Ground direction perpendicular to the view, to sample the body's width. */
const ACROSS = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
const HEIGHTS = [0.5, 0.9, 1.3, 1.7];
const OFFSETS = [-0.4, -0.2, 0, 0.2, 0.4];
/** Thin set pieces a player sees around (lamp posts, fences) do not count as hiding. */
const IGNORED = new Set(['obstacle:lamp', 'obstacle:fence']);

/** Obstacle meshes of a built town (ground and thin pieces excluded). */
export function occluders(world: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const child of world.children) {
    if (!child.name.startsWith('obstacle:') || IGNORED.has(child.name)) continue;
    child.updateMatrixWorld(true);
    child.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o); });
  }
  return out;
}

/** Default camera distance (TownCamera starts at 40) and the closest zoom. */
const DISTANCES = [40, TOWN_CAMERA_MIN_DISTANCE];
/** Camera targets around the NPC: centred on it, and panned a few units each way (a player walking up to it). */
const TARGET_OFFSETS: Array<[number, number]> = [];
for (let tx = -4; tx <= 4; tx += 2) for (let tz = -4; tz <= 4; tz += 2) if (Math.hypot(tx, tz) <= 4.5) TARGET_OFFSETS.push([tx, tz]);

/**
 * Fraction (0..1) of the NPC's sample points hidden from the camera, worst
 * case over real (perspective) camera positions around it.
 */
export function hiddenFraction(meshes: THREE.Object3D[], x: number, z: number, elevation = 0): number {
  const raycaster = new THREE.Raycaster();
  const point = new THREE.Vector3();
  const camera = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let worst = 0;
  for (const [tx, tz] of TARGET_OFFSETS) for (const distance of DISTANCES) {
    camera.set(x + tx, 0, z + tz).addScaledVector(TOWN_TO_CAMERA, distance);
    let hidden = 0, total = 0;
    for (const h of HEIGHTS) for (const off of OFFSETS) {
      point.set(x, elevation + h, z).addScaledVector(ACROSS, off);
      dir.subVectors(camera, point);
      const far = dir.length();
      raycaster.set(point, dir.normalize());
      raycaster.far = far;
      total++;
      if (raycaster.intersectObjects(meshes, false).length) hidden++;
    }
    worst = Math.max(worst, hidden / total);
  }
  return worst;
}
