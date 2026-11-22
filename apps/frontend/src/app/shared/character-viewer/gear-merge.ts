/**
 * A character's gear as ONE skinned mesh with ONE material (the shared atlas): body, shoes, hood
 * pieces (skinned) and helmets, capes, weapons (rigid, baked onto their bone with weight 1).
 * Geometries are cached per (sex, visuals, weapons): characters wearing the same set share one.
 * Never dispose a geometry or material that comes from here.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolveHandAttachments, type HandWeaponType, type Sex, type VisibleEquipment } from '@nanommo/shared';
import type { BodyAsset } from './body-asset';
import type { GearVisual, HideBand, LoadedGear, Region } from './gear-manifest';
import { gripMatrix } from './grip';

export interface GearPlan {
  /** Head/body/cape/shoes visuals, in slot order. */
  visuals: string[];
  covered: Set<Region>;
  hidesHair: boolean;
  hidesBeard: boolean;
  weapons: { side: 'right' | 'left'; visual: string; type: HandWeaponType }[];
}

const WORN_SLOTS = ['body', 'shoes', 'head', 'cape'] as const;

/** What a character wears, from its equipped item ids. Unknown items / missing visuals are skipped. */
export function planGear(
  gear: LoadedGear,
  equipment: VisibleEquipment,
  item: (id: string) => { weaponType?: string } | undefined,
  dominantHand: 'right' | 'left',
): GearPlan {
  const visualOf = (id: string | undefined): [string, GearVisual] | null => {
    const visual = id ? gear.manifest.items[id] : undefined;
    const def = visual ? gear.manifest.visuals[visual] : undefined;
    return visual && def ? [visual, def] : null;
  };
  const plan: GearPlan = { visuals: [], covered: new Set(), hidesHair: false, hidesBeard: false, weapons: [] };
  for (const slot of WORN_SLOTS) {
    const hit = visualOf(equipment[slot]);
    if (!hit) continue;
    const [visual, def] = hit;
    plan.visuals.push(visual);
    for (const r of def.covers ?? []) plan.covered.add(r);
    plan.hidesHair ||= !!def.hidesHair;
    plan.hidesBeard ||= !!def.hidesBeard;
  }
  const hand = (slot: 'mainHand' | 'offHand') => {
    const hit = visualOf(equipment[slot]);
    if (!hit) return null;
    const type = (item(equipment[slot]!)?.weaponType ?? hit[1].weaponType) as HandWeaponType | undefined;
    return type ? { visual: hit[0], type } : null;
  };
  const main = hand('mainHand'), off = hand('offHand');
  const sides = resolveHandAttachments(dominantHand, main?.type ?? null, off?.type ?? null);
  const mainSide = dominantHand;
  for (const side of ['right', 'left'] as const) {
    const w = side === mainSide ? main : off;
    if (w && sides[side]) plan.weapons.push({ side, visual: w.visual, type: w.type });
  }
  return plan;
}

/** Skin hidden under the plan's shells, for this sex. */
export function planBands(gear: LoadedGear, plan: GearPlan, sex: Sex): HideBand[] {
  return plan.visuals.flatMap((v) => gear.manifest.visuals[v]?.hide?.[sex] ?? []);
}

const merged = new WeakMap<LoadedGear, Map<string, THREE.BufferGeometry | null>>();
const ATTRIBUTES = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'] as const;

export function mergedGearGeometry(gear: LoadedGear, sex: Sex, body: BodyAsset, plan: GearPlan, opts: { includeWeapons: boolean }): THREE.BufferGeometry | null {
  const weapons = opts.includeWeapons ? plan.weapons : [];
  const key = `${sex}|${plan.visuals.join(',')}|${weapons.map((w) => `${w.side}:${w.visual}:${w.type}`).join(',')}`;
  let byKey = merged.get(gear);
  if (!byKey) merged.set(gear, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key)!;

  const skeleton = body.body.skeleton;
  const boneIndex = (name: string) => skeleton.bones.findIndex((b) => b.name === name);
  const parts: THREE.BufferGeometry[] = [];
  const rigid = (source: THREE.Object3D, bone: number, local: THREE.Matrix4) => {
    // bind space = the bone's bind frame (inverse of its bone inverse) x its placement on the bone
    const toBind = skeleton.boneInverses[bone].clone().invert().multiply(local);
    source.updateWorldMatrix(true, true);
    const rootInverse = source.matrixWorld.clone().invert();
    source.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone().applyMatrix4(rootInverse.clone().multiply(mesh.matrixWorld)).applyMatrix4(toBind);
      const n = g.getAttribute('position').count;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? bone : 0)), 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      parts.push(g);
    });
  };
  for (const visual of plan.visuals) {
    const def = gear.manifest.visuals[visual];
    if (def.kind === 'skinned') {
      const mesh = gear.skinned[sex].get(visual);
      if (mesh) parts.push(mesh.geometry.clone());
    } else {
      const source = gear.rigid.get(visual), bone = boneIndex(def.bone ?? '');
      if (source && bone >= 0 && def.transform) rigid(source, bone, new THREE.Matrix4().fromArray(def.transform[sex]));
    }
  }
  for (const w of weapons) {
    const source = gear.rigid.get(w.visual), bone = boneIndex(w.side === 'right' ? 'hand_r' : 'hand_l');
    if (source && bone >= 0) rigid(source, bone, gripMatrix(body.fists[w.side], w.type));
  }
  let result: THREE.BufferGeometry | null = null;
  if (parts.length) {
    for (const g of parts) {
      for (const name of Object.keys(g.attributes)) if (!(ATTRIBUTES as readonly string[]).includes(name)) g.deleteAttribute(name);
      if (!g.getIndex()) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
      // one attribute layout for every part (glTF skin indices may come as Uint8 or Uint16)
      const J = g.getAttribute('skinIndex');
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({ length: J.count * 4 }, (_, i) => J.getComponent(Math.floor(i / 4), i % 4)), 4));
      const W = g.getAttribute('skinWeight');
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: W.count * 4 }, (_, i) => W.getComponent(Math.floor(i / 4), i % 4)), 4));
      for (const name of ['normal', 'uv'] as const) if (!g.getAttribute(name)) g.setAttribute(name, new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count * (name === 'uv' ? 2 : 3)).fill(0), name === 'uv' ? 2 : 3));
      for (const name of ['position', 'normal', 'uv'] as const) {
        const a = g.getAttribute(name);
        if (!(a.array instanceof Float32Array) || (a as THREE.BufferAttribute).normalized) g.setAttribute(name, new THREE.Float32BufferAttribute(Array.from({ length: a.count * a.itemSize }, (_, i) => a.getComponent(Math.floor(i / a.itemSize), i % a.itemSize)), a.itemSize));
      }
    }
    result = mergeGeometries(parts, false);
    result.computeBoundingSphere();
  }
  byKey.set(key, result);
  return result;
}

const materials = new WeakMap<LoadedGear, THREE.MeshStandardMaterial>();
/** The one material of all gear (the atlas), page-wide per loaded gear. */
export function gearMaterial(gear: LoadedGear): THREE.MeshStandardMaterial {
  let material = materials.get(gear);
  if (!material) materials.set(gear, (material = new THREE.MeshStandardMaterial({ map: gear.atlas, roughness: 0.9, metalness: 0 })));
  return material;
}

/** The gear mesh of one character: shared geometry and material, bound to that character's skeleton. */
export function gearMesh(geometry: THREE.BufferGeometry, gear: LoadedGear, skeleton: THREE.Skeleton, bindMatrix: THREE.Matrix4): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geometry, gearMaterial(gear));
  mesh.name = 'Gear';
  mesh.frustumCulled = false;
  mesh.bind(skeleton, bindMatrix);
  return mesh;
}

/** A bow's string mesh (GLTFLoader suffixes duplicate names: BowString, BowString_1, …). */
export function bowString(item: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  item.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh && /^BowString(_\d+)?$/.test(o.name)) found = o as THREE.Mesh; });
  return found;
}
