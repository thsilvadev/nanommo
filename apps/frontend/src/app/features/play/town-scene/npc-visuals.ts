/**
 * What each town NPC looks like (decision: docs/superpowers/specs/2026-11-18-npc-visuals-decision.md).
 *
 * A dressed NPC is our base body reduced to its head, wearing a CC0 outfit
 * (tools/npc-assets → /assets/npcs/outfit-*.glb, bound to the body's skeleton by
 * bone name) plus costume pieces built here and pinned to bones; next to it
 * stand its props (pack models from /assets/npcs/props.glb or primitives).
 * Everything is deterministic: same id, same look on every client.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAppearance, Sex } from '@nanommo/shared';
import type { TownCharacterFactory } from './town-character';

export type NpcOutfit = 'male-peasant' | 'female-peasant' | 'male-ranger' | 'female-ranger';
export type NpcCostume =
  | 'mustache' | 'chef-hat' | 'chubby' | 'giant-backpack' | 'cassock' | 'collar' | 'hide-legs'
  | 'leaf-crown' | 'leaf-bundles' | 'star-hat' | 'big-nose' | 'faceless' | 'long-robe' | 'staff'
  | 'headscarf' | 'skirt' | 'no-hood' | 'pipe';
/** Pack models (props.glb nodes) and primitives built here. */
export type NpcPropKind =
  | 'anvil' | 'hammer' | 'tongs' | 'bucket' | 'chest' | 'table' | 'counter' | 'pot' | 'cauldron'
  | 'candles' | 'book-stand' | 'stool' | 'bag' | 'crate'
  | 'forge' | 'mailbox' | 'gourds' | 'herbs' | 'crystal-ball' | 'cards';

export interface NpcFigureBody {
  kind: 'body';
  sex: Sex;
  heightCm: number;
  appearance: Partial<CharacterAppearance>;
  /** Pack outfit; without one the NPC shows the base body (underwear). */
  outfit?: NpcOutfit;
  /** Multiplies the outfit texture (recolours a whole outfit). */
  tint?: string;
  /** Re-hues only the outfit's green cloth to this colour (leather and metal keep theirs). */
  recolor?: string;
  /** Paints a part of the outfit (shirt = body + sleeves, pants = legs), keeping its folds. */
  paint?: { shirt?: string; pants?: string };
  /** Colour of the base body's underwear (when there is no outfit). */
  underwear?: string;
  /** How fat (with 'chubby'): 1 = a little belly, 2 = twice that. */
  belly?: number;
  costume: NpcCostume[];
}
export type NpcFigure = NpcFigureBody | { kind: 'none' };

export interface NpcProp {
  kind: NpcPropKind;
  /** Position relative to the npcSpot, in the NPC's frame: +z is where it looks, +x its left. */
  x: number;
  z: number;
  /** Height above the ground (e.g. on a table); props are first set down on the ground. */
  y?: number;
  rot?: number;
  scale?: number | [number, number, number];
}

export interface NpcVisualDef { figure: NpcFigure; props: NpcProp[] }

const PROPS_ASSET = '../npcs/props.glb';
export const NPC_PROPS_ASSET = PROPS_ASSET;
export const npcOutfitAsset = (outfit: NpcOutfit) => `../npcs/outfit-${outfit}.glb`;

export const NPC_VISUALS: Record<string, NpcVisualDef> = {
  // Traveling merchant with an enormous backpack.
  william: {
    figure: { kind: 'body', sex: 'male', heightCm: 176, appearance: { skin: 1, hair: 0, hairColor: 2, facialHair: 1 }, outfit: 'male-peasant', paint: { shirt: '#c4301c' }, costume: ['giant-backpack'] },
    props: [{ kind: 'bag', x: 1.0, z: -0.7 }, { kind: 'crate', x: -1.1, z: -0.9, scale: 0.8, rot: 20 }],
  },
  // Strong smith with anvil and hammer.
  blacksmith_loren: {
    figure: { kind: 'body', sex: 'female', heightCm: 184, appearance: { skin: 2, hair: 1, hairColor: 3 }, outfit: 'female-ranger', costume: ['no-hood'] },
    props: [{ kind: 'anvil', x: 1.1, z: -0.4, rot: 70 }, { kind: 'hammer', x: 1.1, z: -0.4, y: 0.56, rot: 90, scale: 0.5 }],
  },
  // A simple priest (not a cardinal).
  father_marcelus: {
    figure: { kind: 'body', sex: 'male', heightCm: 172, appearance: { skin: 0, hair: 1, hairColor: 4 }, outfit: 'male-peasant', tint: '#4a4752', costume: ['cassock', 'collar', 'hide-legs'] },
    props: [{ kind: 'candles', x: 0.9, z: -0.7 }, { kind: 'book-stand', x: -0.9, z: -0.6, rot: 30 }],
  },
  // Indigenous elder shaman: base body with straw-coloured underwear, leaf crown, leaves at the waist,
  // a big smoking pipe, white hair; table with gourds and herbs.
  paje_piata: {
    figure: { kind: 'body', sex: 'male', heightCm: 166, appearance: { skin: 3, hair: 2, hairColor: 4, facialHair: 0 }, underwear: '#d8c27a', costume: ['leaf-crown', 'leaf-bundles', 'pipe'] },
    props: [
      { kind: 'table', x: 0, z: -1.2, scale: [0.55, 0.75, 0.75] },
      { kind: 'gourds', x: -0.35, z: -1.2, y: 0.61 },
      { kind: 'herbs', x: 0.35, z: -1.2, y: 0.61 },
    ],
  },
  // Chubby cook with a mustache, a chef's hat and a kitchen counter.
  uncle_phillip: {
    figure: { kind: 'body', sex: 'male', heightCm: 170, appearance: { skin: 1, hair: 3, hairColor: 1 }, outfit: 'male-peasant', paint: { shirt: '#ffffff', pants: '#f4f4f0' }, belly: 2, costume: ['chubby', 'mustache', 'chef-hat'] },
    props: [{ kind: 'counter', x: 0, z: -1.2 }, { kind: 'pot', x: 0.4, z: -1.2, y: 0.89 }, { kind: 'cauldron', x: 1.6, z: -0.7 }],
  },
  // A man unlike the others, with a big treasure chest.
  storage: {
    figure: { kind: 'body', sex: 'male', heightCm: 190, appearance: { skin: 4, hair: 1, hairColor: 0, facialHair: 4 }, outfit: 'male-ranger', recolor: '#b3262a', costume: ['no-hood'] },
    props: [{ kind: 'chest', x: 0, z: -2.0, scale: 2 }],
  },
  // Big-nosed whitesmith: forge behind, anvil, bucket of cooling tools, hat with a red star.
  whitesmith_spitz: {
    figure: { kind: 'body', sex: 'male', heightCm: 168, appearance: { skin: 0, hair: 0, hairColor: 2, facialHair: 3 }, outfit: 'male-peasant', paint: { shirt: '#e0a50c' }, costume: ['star-hat', 'big-nose'] },
    props: [
      { kind: 'forge', x: -0.2, z: -1.5 },
      { kind: 'anvil', x: 1.2, z: -0.5, rot: 70 },
      { kind: 'bucket', x: -1.3, z: -0.6 },
      { kind: 'tongs', x: -1.3, z: -0.6, y: 0.05, scale: 0.4, rot: 15 },
    ],
  },
  // Faceless purple mage, something like Death.
  oracle: {
    figure: { kind: 'body', sex: 'male', heightCm: 195, appearance: { skin: 4, hair: 3, facialHair: 0 }, outfit: 'male-ranger', tint: '#6a3f96', costume: ['long-robe', 'faceless', 'staff'] },
    props: [{ kind: 'candles', x: 0.8, z: -0.8 }, { kind: 'candles', x: -0.8, z: -0.8 }],
  },
  // Fortune teller (user decision 2026-11-18): headscarf, shawl, crystal ball and cards.
  cecilia: {
    figure: { kind: 'body', sex: 'female', heightCm: 166, appearance: { skin: 2, hair: 2, hairColor: 0 }, outfit: 'female-peasant', tint: '#d7b0c4', costume: ['headscarf', 'skirt'] },
    props: [
      { kind: 'table', x: 0, z: -1.0, scale: [0.3, 0.95, 0.6] },
      { kind: 'crystal-ball', x: 0.05, z: -1.0, y: 0.77 },
      { kind: 'cards', x: -0.22, z: -0.95, y: 0.77 },
      { kind: 'stool', x: 0.9, z: -0.8 },
    ],
  },
  // The post office is just a mailbox.
  mailbox: { figure: { kind: 'none' }, props: [{ kind: 'mailbox', x: 0, z: -0.35 }] },
};

// ---- shared primitive building blocks ------------------------------------------

const materials = new Map<string, THREE.MeshStandardMaterial>();
/** Module-wide (a handful of colours, reused by every town scene). */
export function npcMaterial(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(extra);
  let m = materials.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra }); materials.set(key, m); }
  return m;
}
const geometries = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometries.get(key);
  if (!g) { g = make(); geometries.set(key, g); }
  return g;
}
const part = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); return mesh; };

function starShape(outer: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return shape;
}

function primitiveProp(kind: NpcPropKind): THREE.Object3D | null {
  const g = new THREE.Group();
  switch (kind) {
    case 'forge': {
      const brick = npcMaterial('#8a4632');
      g.add(part(geo('forge-body', () => new THREE.BoxGeometry(1.1, 0.9, 0.8)), brick, 0, 0.45, 0));
      g.add(part(geo('forge-top', () => new THREE.BoxGeometry(1.2, 0.12, 0.9)), npcMaterial('#5e3326'), 0, 0.96, 0));
      g.add(part(geo('forge-mouth', () => new THREE.BoxGeometry(0.5, 0.32, 0.06)), npcMaterial('#ff7a1a', { emissive: '#ff5a00', emissiveIntensity: 1.4 }), 0, 0.42, 0.4));
      g.add(part(geo('forge-hood', () => new THREE.CylinderGeometry(0.22, 0.5, 0.5, 4)), brick, 0, 1.27, 0));
      g.add(part(geo('forge-chimney', () => new THREE.CylinderGeometry(0.16, 0.18, 1.6, 8)), npcMaterial('#6f3a2a'), 0, 2.3, 0));
      return g;
    }
    case 'mailbox': {
      g.add(part(geo('mail-post', () => new THREE.BoxGeometry(0.12, 1.0, 0.12)), npcMaterial('#5a3e2a'), 0, 0.5, 0));
      g.add(part(geo('mail-box', () => new THREE.BoxGeometry(0.42, 0.34, 0.62)), npcMaterial('#2f5fa8'), 0, 1.15, 0));
      const lid = part(geo('mail-lid', () => new THREE.CylinderGeometry(0.21, 0.21, 0.62, 12, 1, false, 0, Math.PI)), npcMaterial('#2f5fa8'), 0, 1.32, 0);
      lid.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      g.add(lid);
      g.add(part(geo('mail-flag-pole', () => new THREE.BoxGeometry(0.03, 0.34, 0.03)), npcMaterial('#c9c9c9'), 0.23, 1.32, -0.12));
      g.add(part(geo('mail-flag', () => new THREE.BoxGeometry(0.02, 0.12, 0.16)), npcMaterial('#d0342c'), 0.23, 1.44, -0.04));
      g.add(part(geo('mail-slot', () => new THREE.BoxGeometry(0.22, 0.03, 0.02)), npcMaterial('#1a1a22'), 0, 1.2, 0.315));
      return g;
    }
    case 'gourds': {
      const shell = npcMaterial('#b5793a');
      const bowl = geo('gourd-bowl', () => new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
      for (const [x, z, s] of [[0, 0, 1], [0.2, 0.06, 0.8], [-0.12, 0.14, 0.7]] as const) {
        const b = part(bowl, shell, x, 0.11 * s, z);
        b.scale.setScalar(s);
        b.rotation.x = Math.PI;
        g.add(b);
      }
      g.add(part(geo('gourd-whole', () => new THREE.SphereGeometry(0.09, 10, 8)), npcMaterial('#c98a3a'), -0.18, 0.09, -0.08));
      return g;
    }
    case 'herbs': {
      const leaf = geo('herb-bundle', () => new THREE.ConeGeometry(0.06, 0.32, 6));
      const tie = geo('herb-tie', () => new THREE.TorusGeometry(0.035, 0.01, 4, 10));
      for (const [i, color] of ['#4f8a3a', '#6aa24a', '#3d6e2e'].entries()) {
        const bundle = part(leaf, npcMaterial(color), -0.12 + i * 0.12, 0.05, (i % 2) * 0.08);
        bundle.rotation.z = Math.PI / 2 + (i - 1) * 0.3;
        g.add(bundle);
        const t = part(tie, npcMaterial('#a07a4a'), -0.12 + i * 0.12, 0.05, (i % 2) * 0.08);
        t.rotation.y = Math.PI / 2;
        g.add(t);
      }
      return g;
    }
    case 'crystal-ball': {
      g.add(part(geo('ball-stand', () => new THREE.CylinderGeometry(0.06, 0.09, 0.06, 10)), npcMaterial('#6b4a2c'), 0, 0.03, 0));
      g.add(part(geo('ball', () => new THREE.SphereGeometry(0.11, 18, 14)), npcMaterial('#c9b5ff', { emissive: '#8a6dff', emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.85 }), 0, 0.16, 0));
      return g;
    }
    case 'cards': {
      const card = geo('card', () => new THREE.BoxGeometry(0.06, 0.004, 0.09));
      for (let i = 0; i < 4; i++) {
        const c = part(card, npcMaterial(i === 3 ? '#d0342c' : '#f1e6c8'), i * 0.04, 0.002 + i * 0.001, 0);
        c.rotation.y = -0.3 + i * 0.2;
        g.add(c);
      }
      return g;
    }
    default:
      return null;
  }
}

/** Centres an object on its holder and sets it down on the ground (lowest point at y = 0). */
function setDown(object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.y)) return;
  const centre = box.getCenter(new THREE.Vector3());
  object.position.x -= centre.x;
  object.position.z -= centre.z;
  object.position.y -= box.min.y;
}

/**
 * The props of an NPC, laid out in its own frame (the caller places the group
 * on the npcSpot and turns it to the NPC's facing).
 */
export async function buildNpcVisual(def: NpcVisualDef, deps: { factory: TownCharacterFactory }): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'npc-props';
  const needsPack = def.props.some((p) => !primitiveProp(p.kind));
  const pack = needsPack ? await deps.factory.cache.glb(PROPS_ASSET) : null;
  for (const prop of def.props) {
    let object = primitiveProp(prop.kind);
    if (!object) {
      const source = pack!.getObjectByName(prop.kind);
      if (!source) throw new Error(`props.glb has no ${prop.kind}`);
      // Some pack props are skinned (the chest's lid): a plain clone would keep drawing at the source's bones.
      object = cloneSkinned(source);
      object.position.set(0, 0, 0);
    }
    const holder = new THREE.Group();
    holder.name = `prop:${prop.kind}`;
    const s = prop.scale ?? 1;
    if (Array.isArray(s)) object.scale.set(s[0], s[1], s[2]); else object.scale.setScalar(s);
    holder.add(object);
    setDown(object);
    holder.position.set(prop.x, prop.y ?? 0, prop.z);
    holder.rotation.y = ((prop.rot ?? 0) * Math.PI) / 180;
    holder.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(holder);
  }
  return group;
}

// ---- costume (pinned to bones of a dressed body) --------------------------------

type Offset = [number, number, number];

/**
 * Places `piece` at a model-frame offset from `bone` (the character posed, the
 * model facing +z), then parents it to the bone so it follows the animation.
 */
function pin(model: THREE.Object3D, bone: THREE.Object3D | undefined, piece: THREE.Object3D, offset: Offset): void {
  if (!bone) return;
  // The model may already stand anywhere in the town (dressing finishes after it was placed):
  // aim in world space, then express the target in the model's own frame before attaching.
  model.updateMatrixWorld(true);
  const facing = model.getWorldQuaternion(new THREE.Quaternion());
  const target = bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(...offset).applyQuaternion(facing));
  model.add(piece);
  piece.position.copy(model.worldToLocal(target));
  model.updateMatrixWorld(true);
  bone.attach(piece);
  piece.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
}

/**
 * Parents `piece` to `bone` so that, in the body's bind pose, it sits at
 * `point` (armature space, model facing +z): independent of the current pose,
 * which matters on the head (the Idle pose tilts it).
 */
function pinBind(skeleton: THREE.Skeleton, boneName: string, piece: THREE.Object3D, point: THREE.Vector3): void {
  const index = skeleton.bones.findIndex((b) => b.name === boneName);
  if (index < 0) return;
  const inverse = skeleton.boneInverses[index];
  const bindRotation = new THREE.Quaternion();
  inverse.clone().invert().decompose(new THREE.Vector3(), bindRotation, new THREE.Vector3());
  piece.position.copy(point).applyMatrix4(inverse);
  piece.quaternion.premultiply(bindRotation.invert());
  skeleton.bones[index].add(piece);
  piece.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
}

const cloth = (color: string) => npcMaterial(color, { side: THREE.DoubleSide });

/** Moves part of a costume from the shared clock (same input, same pose on every client). */
export type NpcAnimator = (nowMs: number) => void;
const frac = (v: number) => v - Math.floor(v);

/**
 * Adds the costume pieces of `figure` to a posed body (`model` holds the
 * skeleton). `face` is the eyes' centre relative to the Head bone, in the model
 * frame (measured on the body), so face and head pieces land on the face.
 */
export function dressCostume(model: THREE.Object3D, figure: NpcFigureBody, skinColor: string, rig: { skeleton: THREE.Skeleton; face: THREE.Vector3 }): NpcAnimator[] {
  const animators: NpcAnimator[] = [];
  const bone = (name: string) => model.getObjectByName(name);
  /** Head pieces: placed from the eyes' centre in the bind pose. */
  const onHead = (piece: THREE.Object3D, dx: number, dy: number, dz: number) => pinBind(rig.skeleton, 'Head', piece, rig.face.clone().add(new THREE.Vector3(dx, dy, dz)));
  /** Body pieces: placed from a bone's bind position (the Idle pose turns the torso a little). */
  const onBone = (name: string, piece: THREE.Object3D, dx: number, dy: number, dz: number) => {
    const index = rig.skeleton.bones.findIndex((b) => b.name === name);
    if (index < 0) return;
    const at = new THREE.Vector3().setFromMatrixPosition(rig.skeleton.boneInverses[index].clone().invert());
    pinBind(rig.skeleton, name, piece, at.add(new THREE.Vector3(dx, dy, dz)));
  };
  for (const item of figure.costume) {
    switch (item) {
      case 'chubby':
      case 'hide-legs':
      case 'no-hood':
        break; // applied to the body and the outfit (TownCharacter)
      case 'chef-hat': {
        const hat = new THREE.Group();
        const white = npcMaterial('#f7f5ef');
        hat.add(part(geo('chef-band', () => new THREE.CylinderGeometry(0.115, 0.11, 0.12, 16)), white, 0, 0.03, 0));
        const puff = part(geo('chef-puff', () => new THREE.SphereGeometry(0.16, 16, 10)), white, 0, 0.17, 0);
        puff.scale.set(1, 0.75, 1);
        hat.add(puff);
        onHead(hat, 0, 0.1, -0.045);
        break;
      }
      case 'mustache': {
        // The catalogue's mustache is painted on the face texture, which the town does not compose: a modelled one.
        const tuft = geo('mustache-tuft', () => new THREE.CapsuleGeometry(0.014, 0.05, 3, 6));
        for (const side of [-1, 1]) {
          const t = part(tuft, npcMaterial('#3a2416'));
          t.rotation.z = side * 1.15;
          onHead(t, side * 0.028, -0.06, 0.06);
        }
        break;
      }
      case 'giant-backpack': {
        const pack = new THREE.Group();
        pack.add(part(geo('pack-body', () => new THREE.BoxGeometry(0.85, 1.15, 0.55)), npcMaterial('#7a5a3a'), 0, 0, 0));
        pack.add(part(geo('pack-flap', () => new THREE.BoxGeometry(0.88, 0.3, 0.58)), npcMaterial('#5e4329'), 0, 0.45, 0));
        const roll = part(geo('pack-roll', () => new THREE.CylinderGeometry(0.17, 0.17, 0.95, 10)), npcMaterial('#6b7a3e'), 0, 0.75, 0);
        roll.rotation.z = Math.PI / 2;
        pack.add(roll);
        pack.add(part(geo('pack-pot', () => new THREE.CylinderGeometry(0.16, 0.13, 0.2, 10)), npcMaterial('#3c3f46', { metalness: 0.5 }), 0.5, -0.1, 0));
        pack.add(part(geo('pack-pan', () => new THREE.CylinderGeometry(0.15, 0.15, 0.03, 12)), npcMaterial('#2b2d33', { metalness: 0.5 }), -0.47, 0.15, 0.05)).children.at(-1)!.rotation.z = Math.PI / 2;
        for (const x of [-0.38, 0.38]) pack.add(part(geo('pack-pole', () => new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6)), npcMaterial('#4a3524'), x, 0.25, -0.3));
        // Fitted on the Idle pose (its forward lean would tilt a bind-pose backpack).
        pin(model, bone('spine_03'), pack, [0, 0.1, -0.42]);
        break;
      }
      case 'cassock':
        onBone('pelvis', part(geo('cassock', () => new THREE.CylinderGeometry(0.22, 0.42, 1.0, 16, 1, true)), cloth('#22222a')), 0, -0.47, 0);
        break;
      case 'collar': {
        const collar = part(geo('collar', () => new THREE.TorusGeometry(0.07, 0.018, 6, 16)), npcMaterial('#f4f4f0'));
        collar.rotation.x = Math.PI / 2;
        onBone('neck_01', collar, 0, 0.0, 0.01);
        break;
      }
      case 'leaf-crown': {
        const crown = new THREE.Group();
        const leaf = geo('crown-leaf', () => new THREE.PlaneGeometry(0.06, 0.22));
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * Math.PI * 2;
          const l = part(leaf, cloth(i % 2 ? '#4f8a3a' : '#c9a03a'), Math.sin(a) * 0.12, 0.08, Math.cos(a) * 0.12);
          l.rotation.set(-0.35, a, 0, 'YXZ');
          crown.add(l);
        }
        crown.add(part(geo('crown-band', () => new THREE.TorusGeometry(0.115, 0.018, 6, 18)), npcMaterial('#8a5a2a'))).children.at(-1)!.rotation.x = Math.PI / 2;
        onHead(crown, 0, 0.1, -0.05);
        break;
      }
      case 'leaf-bundles':
        for (const x of [-0.17, 0.17]) {
          const bundle = part(geo('leaf-bundle', () => new THREE.ConeGeometry(0.06, 0.32, 6)), npcMaterial('#4f8a3a'));
          bundle.rotation.x = Math.PI;
          onBone('pelvis', bundle, x, -0.18, 0.08);
        }
        break;
      case 'star-hat': {
        const hat = new THREE.Group();
        hat.add(part(geo('hat-brim', () => new THREE.CylinderGeometry(0.2, 0.2, 0.025, 18)), npcMaterial('#2b2f3a'), 0, 0, 0));
        hat.add(part(geo('hat-crown', () => new THREE.CylinderGeometry(0.11, 0.125, 0.17, 16)), npcMaterial('#2b2f3a'), 0, 0.095, 0));
        const star = part(geo('hat-star', () => new THREE.ExtrudeGeometry(starShape(0.055, 0.024), { depth: 0.012, bevelEnabled: false })), npcMaterial('#d22a2a', { emissive: '#7a0a0a', emissiveIntensity: 0.4 }), 0, 0.1, 0.118);
        hat.add(star);
        onHead(hat, 0, 0.1, -0.05);
        break;
      }
      case 'big-nose': {
        // Long and pointy.
        const nose = part(geo('nose-pointy', () => new THREE.ConeGeometry(0.026, 0.12, 10)), npcMaterial(skinColor));
        nose.rotation.x = Math.PI / 2;
        onHead(nose, 0, -0.035, 0.07);
        break;
      }
      case 'faceless': {
        // A dark void over the whole face, with two small lights where the eyes would be.
        const voidFace = part(geo('void', () => new THREE.SphereGeometry(0.1, 14, 10)), new THREE.MeshBasicMaterial({ color: '#050208' }));
        voidFace.scale.set(1, 1.25, 0.9);
        onHead(voidFace, 0, -0.03, -0.005);
        for (const x of [-0.032, 0.032]) onHead(part(geo('eye-glow', () => new THREE.SphereGeometry(0.012, 6, 4)), new THREE.MeshBasicMaterial({ color: '#c7a6ff' })), x, 0, 0.085);
        break;
      }
      case 'long-robe':
        onBone('pelvis', part(geo('robe', () => new THREE.CylinderGeometry(0.22, 0.62, 1.05, 16, 1, true)), cloth('#3d2358')), 0, -0.47, 0);
        break;
      case 'staff': {
        const staff = new THREE.Group();
        staff.add(part(geo('staff-pole', () => new THREE.CylinderGeometry(0.025, 0.03, 1.9, 6)), npcMaterial('#2b1d14')));
        staff.add(part(geo('staff-crystal', () => new THREE.OctahedronGeometry(0.11, 0)), npcMaterial('#b07cff', { emissive: '#8a4dff', emissiveIntensity: 1.2 }), 0, 1.0, 0));
        pin(model, bone('hand_r'), staff, [0, 0, 0.03]);
        break;
      }
      case 'headscarf': {
        const scarf = part(geo('scarf', () => new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), cloth('#8a2a4a'));
        scarf.scale.set(1.1, 1.05, 1.2);
        onHead(scarf, 0, 0.045, -0.05);
        onHead(part(geo('scarf-knot', () => new THREE.SphereGeometry(0.04, 8, 6)), npcMaterial('#8a2a4a')), 0, 0, -0.18);
        break;
      }
      case 'pipe': {
        // A big pipe in the mouth, its bowl smoking: puffs rise, grow and fade on their own phase.
        const pipe = new THREE.Group();
        const wood = npcMaterial('#5a3a22');
        const stem = part(geo('pipe-stem', () => new THREE.CylinderGeometry(0.012, 0.016, 0.24, 8)), wood, 0, 0, 0.12);
        stem.rotation.x = Math.PI / 2 + 0.2;
        pipe.add(stem);
        pipe.add(part(geo('pipe-bowl', () => new THREE.CylinderGeometry(0.05, 0.04, 0.11, 12)), wood, 0, 0.02, 0.24));
        pipe.add(part(geo('pipe-ember', () => new THREE.CircleGeometry(0.042, 12)), npcMaterial('#ff6a1a', { emissive: '#ff4a00', emissiveIntensity: 1.5 }), 0, 0.078, 0.24)).children.at(-1)!.rotation.x = -Math.PI / 2;
        const puffs = Array.from({ length: 6 }, (_, i) => {
          const puff = part(geo('pipe-puff', () => new THREE.IcosahedronGeometry(0.05, 1)), new THREE.MeshBasicMaterial({ color: '#d9d6cf', transparent: true, depthWrite: false }), 0, 0.1, 0.24);
          puff.name = 'pipe-smoke';
          pipe.add(puff);
          return { puff, phase: i / 6 };
        });
        onHead(pipe, 0, -0.07, 0.065);
        for (const { puff } of puffs) puff.castShadow = false;
        animators.push((now) => {
          for (const { puff, phase } of puffs) {
            const t = frac(now / 2600 + phase);
            puff.position.set(Math.sin(t * 5 + phase * 9) * 0.05 * t, 0.1 + t * 0.55, 0.24 + t * 0.06);
            puff.scale.setScalar(0.6 + t * 2.2);
            (puff.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
          }
        });
        break;
      }
      case 'skirt':
        // A flared skirt from the waist.
        onBone('pelvis', part(geo('skirt', () => new THREE.CylinderGeometry(0.19, 0.36, 0.42, 16, 1, true)), cloth('#5a2a6a')), 0, -0.13, 0);
        break;
    }
  }
  return animators;
}

/** Appearance of a dressed NPC: its id-derived look with the registry's overrides. */
export function npcAppearance(base: CharacterAppearance, figure: NpcFigureBody): CharacterAppearance {
  return { ...base, ...figure.appearance } as CharacterAppearance;
}
