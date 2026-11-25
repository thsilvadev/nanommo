/**
 * The procedural bow shot (draw and loose) on our 65-joint skeleton. Shared by the
 * character rig and by character-rig monsters that carry a bow (Kwaiouá Ranger).
 */
import * as THREE from 'three';
import { bowString } from './gear-merge';

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** A bow held in one hand. */
export interface HeldBow { side: 'right' | 'left'; item: THREE.Object3D }

/** Per-viewer state of the bow shot: the string/arrow parts and the bones to restore next frame. */
export class BowShotState {
  parts: BowDrawParts | null = null;
  /**
   * Bone rotations as the mixer left them before the bow pose overrode them. The mixer
   * only writes a bone when its mixed value changes, so they are put back before the
   * next frame; otherwise a static pose would keep the drawn arms.
   */
  readonly ikRestore: Array<[THREE.Bone, THREE.Quaternion]> = [];
  /** Puts back the arm rotations the last shot overrode (call before the mixer poses the frame). */
  restore(): void { for (const [bone, quaternion] of this.ikRestore.splice(0)) bone.quaternion.copy(quaternion); }
}

/**
 * Draw and loose, posed over the animated arms with two-bone IK. `progress` is the
 * fraction of the Attack window (0..1), or null when no shot is under way. The bow
 * arm reaches forward, the other hand pulls the string from the bow to the face and
 * lets go; the string bends towards that hand and an arrow sits on it until release.
 * `root` is the body root (+Z forward, +Y up). Returns how far the string is drawn (0..1).
 */
export function poseBowShot(state: BowShotState, bones: Map<string, THREE.Bone>, root: THREE.Object3D, bow: HeldBow | null, progress: number | null): number {
  const parts = bow ? bowParts(state, bow.item) : null;
  if (!bow || !parts || progress === null) {
    if (parts) { parts.restString(); parts.arrow.visible = false; }
    return 0;
  }
  const p = progress;
  // Phases: raise 0-0.18, draw 0.18-0.5, hold 0.5-0.62, loose 0.62-0.72, lower 0.72-1.
  const weight = p < 0.18 ? smooth(p / 0.18) : p > 0.72 ? smooth((1 - p) / 0.28) : 1;
  const drawn = p < 0.18 ? 0 : p < 0.5 ? smooth((p - 0.18) / 0.32) : p < 0.62 ? 1 : 0;
  const follow = p < 0.62 ? 0 : smooth(Math.min(1, (p - 0.62) / 0.1));

  const bowSide = bow.side === 'right' ? 'r' : 'l';
  const drawSide = bowSide === 'r' ? 'l' : 'r';
  for (const side of ['r', 'l']) {
    for (const name of [`upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`]) {
      const bone = bones.get(name)!;
      state.ikRestore.push([bone, bone.quaternion.clone()]);
    }
  }
  const out = bowSide === 'r' ? -1 : 1; // the character's right side is -X in body space
  root.updateMatrixWorld(true);
  const local = (name: string) => root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(bones.get(name)!.matrixWorld));
  const toWorld = (v: THREE.Vector3) => root.localToWorld(v.clone());
  const reach = (side: string) => local(`lowerarm_${side}`).distanceTo(local(`upperarm_${side}`)) + local(`hand_${side}`).distanceTo(local(`lowerarm_${side}`));

  // Bow arm: straight out in front of its shoulder, so the bow stays clear of the face.
  const shoulder = local(`upperarm_${bowSide}`);
  const head = local('Head');
  const aim = new THREE.Vector3(out * 0.22, 0.08, 1).normalize();
  const bowHand = shoulder.clone().addScaledVector(aim, reach(bowSide) * 0.99);
  twoBoneIk(bones, bowSide, toWorld(bowHand), toWorld(shoulder.clone().add(new THREE.Vector3(out * 0.6, -1, -0.2))), weight);
  // Bow upright, string towards the archer.
  const rootQuat = root.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQuat);
  const back = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQuat);
  const bowWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(back, up, new THREE.Vector3().crossVectors(back, up)));
  orientBone(bones.get(`hand_${bowSide}`)!, bowWorld.multiply(bow.item.quaternion.clone().invert()), weight);

  // Draw hand: from the nocking point on the resting string to the face, then away on release.
  bow.item.updateMatrixWorld(true);
  parts.restString();
  const nock = root.worldToLocal(bow.item.localToWorld(parts.nock.clone()));
  // Anchor under the chin, on the drawing side: as long a draw as the facing-forward body allows.
  const anchor = new THREE.Vector3(head.x - out * 0.05, head.y - 0.07, head.z + 0.06);
  const released = anchor.clone().add(new THREE.Vector3(-out * 0.08, 0.02, -0.1));
  const hand = nock.clone().lerp(anchor, drawn).lerp(released, follow);
  twoBoneIk(bones, drawSide, toWorld(hand), toWorld(local(`upperarm_${drawSide}`).add(new THREE.Vector3(-out * 1, 0.25, -0.6))), weight);

  // String and arrow follow the drawing hand (in bow space).
  bow.item.updateMatrixWorld(true);
  const pull = bow.item.worldToLocal(toWorld(nock.clone().lerp(anchor, drawn)));
  const pulled = drawn * weight;
  parts.bendString(new THREE.Vector3().lerpVectors(parts.nock, pull, pulled));
  parts.arrow.visible = p >= 0.12 && p < 0.62;
  if (parts.arrow.visible) parts.placeArrow(new THREE.Vector3().lerpVectors(parts.nock, pull, pulled));
  return pulled;
}

/** String vertices and an arrow for a bow item, created once per bow object. */
function bowParts(state: BowShotState, item: THREE.Object3D): BowDrawParts | null {
  if (state.parts?.item === item) return state.parts;
  // gear bows: a 'BowString' child; the old type model: the 'White' material
  let string: THREE.Mesh | null = bowString(item);
  if (!string) item.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material).name === 'White') string = mesh;
  });
  if (!string) return null;
  const stringMesh = string as THREE.Mesh;
  // Own copy of the geometry: the cached bow object is shared.
  stringMesh.geometry = stringMesh.geometry.clone();
  const position = stringMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const rest = new Float32Array(position.array as ArrayLike<number>);
  let top = 0, x = 0;
  for (let i = 0; i < position.count; i++) { top = Math.max(top, Math.abs(rest[i * 3 + 1])); x += rest[i * 3]; }
  x /= position.count;
  const nock = new THREE.Vector3(x, 0, 0);
  const arrow = buildArrow();
  arrow.visible = false;
  item.add(arrow);
  const parts: BowDrawParts = {
    item, nock, arrow,
    restString: () => { (position.array as Float32Array).set(rest); position.needsUpdate = true; },
    bendString: (to) => {
      const out = position.array as Float32Array;
      for (let i = 0; i < position.count; i++) {
        // Straight lines from each tip to the pulled nocking point.
        const t = 1 - Math.min(1, Math.abs(rest[i * 3 + 1]) / top);
        out[i * 3] = rest[i * 3] + (to.x - nock.x) * t;
        out[i * 3 + 1] = rest[i * 3 + 1] + to.y * t;
        out[i * 3 + 2] = rest[i * 3 + 2] + (to.z - nock.z) * t;
      }
      position.needsUpdate = true;
    },
    placeArrow: (at) => {
      // Nock on the string, shaft through the bow's grip (the origin), pointing away from the archer.
      const forward = at.clone().negate().normalize();
      arrow.position.copy(at);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
    },
  };
  state.parts = parts;
  return parts;
}

export interface BowDrawParts {
  item: THREE.Object3D;
  /** Middle of the resting string, in bow space. */
  nock: THREE.Vector3;
  arrow: THREE.Object3D;
  restString(): void;
  /** Bends the string into two straight segments meeting at `to` (bow space). */
  bendString(to: THREE.Vector3): void;
  placeArrow(nock: THREE.Vector3): void;
}

const worldPosition = (object: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);

/** Rotates `bone` so the direction to `child` points at `target` (world space), blended by `weight`. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3, weight: number): void {
  const origin = worldPosition(bone);
  const from = worldPosition(child).sub(origin).normalize();
  const to = target.clone().sub(origin).normalize();
  const world = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  orientBone(bone, world, weight);
}

/** Sets a bone's world rotation (blended with its animated one by `weight`). */
function orientBone(bone: THREE.Object3D, world: THREE.Quaternion, weight: number): void {
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.slerp(parent.invert().multiply(world), weight);
  bone.updateMatrixWorld(true);
}

/** Two-bone IK on an arm: hand to `target`, elbow bent towards `pole` (world points). */
function twoBoneIk(bones: Map<string, THREE.Bone>, side: string, target: THREE.Vector3, pole: THREE.Vector3, weight: number): void {
  if (weight <= 0) return;
  const upper = bones.get(`upperarm_${side}`)!, lower = bones.get(`lowerarm_${side}`)!, hand = bones.get(`hand_${side}`)!;
  upper.updateMatrixWorld(true);
  const shoulder = worldPosition(upper);
  const a = shoulder.distanceTo(worldPosition(lower));
  const b = worldPosition(lower).distanceTo(worldPosition(hand));
  const toTarget = target.clone().sub(shoulder);
  const d = Math.min(Math.max(toTarget.length(), 1e-4), (a + b) * 0.999);
  const dir = toTarget.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const bend = pole.clone().sub(shoulder);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-10) bend.set(0, -1, 0).addScaledVector(dir, -dir.y);
  bend.normalize();
  const elbow = shoulder.clone().addScaledVector(dir, a * cosA).addScaledVector(bend, a * sinA);
  aimBone(upper, lower, elbow, weight);
  aimBone(lower, hand, shoulder.clone().addScaledVector(dir, d), weight);
}

/** Arrow with its nock at the origin, pointing along +Y (also flown by the battle arena). */
export function buildArrow(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'bow:arrow';
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.8, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.7, roughness: 0.35, flatShading: true });
  const feather = new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.9, side: THREE.DoubleSide });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.72, 5), wood);
  shaft.position.y = 0.36;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.045, 4), steel);
  head.position.y = 0.742;
  group.add(shaft, head);
  for (let i = 0; i < 3; i++) {
    const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.07), feather);
    vane.position.y = 0.06;
    vane.rotation.y = (i * Math.PI * 2) / 3;
    vane.translateX(0.009);
    group.add(vane);
  }
  group.traverse((child) => { child.frustumCulled = false; });
  return group;
}
