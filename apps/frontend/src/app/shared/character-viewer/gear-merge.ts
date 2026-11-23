/**
 * A character's gear as ONE skinned mesh with ONE material (the shared atlas): body, shoes, hood
 * pieces (skinned) and helmets, capes, weapons (rigid, baked onto their bone with weight 1).
 * Geometries are cached per (sex, visuals, weapons): characters wearing the same set share one.
 * Never dispose a geometry or material that comes from here.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { refineGlint, resolveHandAttachments, type HandWeaponType, type RefineGlint, type Sex, type VisibleEquipment, type VisibleRefinement } from '@nanommo/shared';
import type { BodyAsset } from './body-asset';
import type { GearVisual, HideBand, LoadedGear, Region } from './gear-manifest';
import { gripMatrix } from './grip';

export interface GearPlan {
  /** Head/body/cape/shoes visuals, in slot order. */
  visuals: string[];
  /** Refinement shimmer of each visual (same order as `visuals`). */
  glints: RefineGlint[];
  covered: Set<Region>;
  hidesHair: boolean;
  hidesBeard: boolean;
  weapons: { side: 'right' | 'left'; visual: string; type: HandWeaponType; glint: RefineGlint }[];
}

const WORN_SLOTS = ['body', 'shoes', 'head', 'cape'] as const;

/** What a character wears, from its equipped item ids. Unknown items / missing visuals are skipped. */
export function planGear(
  gear: LoadedGear,
  equipment: VisibleEquipment,
  item: (id: string) => { weaponType?: string } | undefined,
  dominantHand: 'right' | 'left',
  refinement: VisibleRefinement | null = null,
): GearPlan {
  const visualOf = (id: string | undefined): [string, GearVisual] | null => {
    const visual = id ? gear.manifest.items[id] : undefined;
    const def = visual ? gear.manifest.visuals[visual] : undefined;
    return visual && def ? [visual, def] : null;
  };
  const plan: GearPlan = { visuals: [], glints: [], covered: new Set(), hidesHair: false, hidesBeard: false, weapons: [] };
  for (const slot of WORN_SLOTS) {
    const hit = visualOf(equipment[slot]);
    if (!hit) continue;
    const [visual, def] = hit;
    plan.visuals.push(visual);
    plan.glints.push(refineGlint(refinement?.[slot]));
    for (const r of def.covers ?? []) plan.covered.add(r);
    plan.hidesHair ||= !!def.hidesHair;
    plan.hidesBeard ||= !!def.hidesBeard;
  }
  const hand = (slot: 'mainHand' | 'offHand') => {
    const hit = visualOf(equipment[slot]);
    if (!hit) return null;
    const type = (item(equipment[slot]!)?.weaponType ?? hit[1].weaponType) as HandWeaponType | undefined;
    return type ? { visual: hit[0], type, glint: refineGlint(refinement?.[slot]) } : null;
  };
  const main = hand('mainHand'), off = hand('offHand');
  const sides = resolveHandAttachments(dominantHand, main?.type ?? null, off?.type ?? null);
  const mainSide = dominantHand;
  for (const side of ['right', 'left'] as const) {
    const w = side === mainSide ? main : off;
    if (w && sides[side]) plan.weapons.push({ side, visual: w.visual, type: w.type, glint: w.glint });
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
  const key = `${sex}|${plan.visuals.map((v, i) => `${v}:${plan.glints[i] ?? 0}`).join(',')}|${weapons.map((w) => `${w.side}:${w.visual}:${w.type}:${w.glint}`).join(',')}`;
  let byKey = merged.get(gear);
  if (!byKey) merged.set(gear, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key)!;

  const skeleton = body.body.skeleton;
  const boneIndex = (name: string) => skeleton.bones.findIndex((b) => b.name === name);
  const parts: THREE.BufferGeometry[] = [];
  /** Refinement shimmer of each part (its material slot in gearMaterials()). */
  const partGlints: RefineGlint[] = [];
  const rigid = (source: THREE.Object3D, bone: number, local: THREE.Matrix4, glint: RefineGlint) => {
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
      partGlints.push(glint);
    });
  };
  plan.visuals.forEach((visual, i) => {
    const def = gear.manifest.visuals[visual];
    const glint = plan.glints[i] ?? 0;
    if (def.kind === 'skinned') {
      const mesh = gear.skinned[sex].get(visual);
      if (mesh) { parts.push(mesh.geometry.clone()); partGlints.push(glint); }
    } else {
      const source = gear.rigid.get(visual), bone = boneIndex(def.bone ?? '');
      if (source && bone >= 0 && def.transform) rigid(source, bone, new THREE.Matrix4().fromArray(def.transform[sex]), glint);
    }
  });
  for (const w of weapons) {
    const source = gear.rigid.get(w.visual), bone = boneIndex(w.side === 'right' ? 'hand_r' : 'hand_l');
    if (source && bone >= 0) rigid(source, bone, gripMatrix(body.fists[w.side], w.type), w.glint);
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
    // Refined pieces: one group per part, its material slot = its shimmer (0 plain, 1 silver, 2 gold).
    const glinting = partGlints.some((g) => g > 0);
    result = mergeGeometries(parts, glinting);
    if (glinting) {
      result.groups.forEach((group, i) => { group.materialIndex = partGlints[i] ?? 0; });
      // neighbouring parts with the same material draw as one
      const groups = result.groups.reduce<THREE.BufferGeometry['groups']>((out, g) => {
        const last = out[out.length - 1];
        if (last && last.materialIndex === g.materialIndex && last.start + last.count === g.start) last.count += g.count;
        else out.push({ ...g });
        return out;
      }, []);
      result.clearGroups();
      for (const g of groups) result.addGroup(g.start, g.count, g.materialIndex);
    }
    result.computeBoundingSphere();
  }
  byKey.set(key, result);
  return result;
}

const materials = new WeakMap<LoadedGear, [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]>();

/** Shared clock of the shimmer: read by three.js on every uniform upload, so nothing has to tick it. */
const GLINT_TIME = { get value(): number { return (performance.now() / 1000) % 3600; } };
/** Tint of the shimmer per level: silver-blue chrome (+10, +11), gold (+12). */
const GLINT_TINTS: Record<1 | 2, THREE.Color> = { 1: new THREE.Color(0.72, 0.84, 1.0), 2: new THREE.Color(1.0, 0.72, 0.26) };

/**
 * The atlas material plus an animated "chrome" shimmer for refined gear (MU-style): the piece is
 * tinted, a sheen follows the surface normal and curvy veins of energy flow over it.
 */
function glintMaterial(atlas: THREE.Texture, glint: 1 | 2): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.45, metalness: 0.35 });
  material.name = glint === 2 ? 'GearGlintGold' : 'GearGlintSilver';
  material.customProgramCacheKey = () => `gear-glint-${glint}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uGlintTime'] = GLINT_TIME;
    shader.uniforms['uGlintTint'] = { value: GLINT_TINTS[glint] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintPos;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvGlintPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintPos;\nuniform float uGlintTime;\nuniform vec3 uGlintTint;')
      .replace('#include <dithering_fragment>', `
        {
          vec3 n = normalize(normal);
          // chrome: a slowly drifting sheen that depends on where the surface faces
          float sheen = 0.5 + 0.5 * sin(n.y * 5.0 + n.x * 3.0 + uGlintTime * 1.6);
          // energy: a slowly flowing, domain-warped field; bright curvy veins where it crosses zero
          float t = uGlintTime;
          vec3 p = vGlintPos * 7.0;
          vec3 warp = vec3(sin(p.y * 1.3 + t * 0.9) + sin(p.z * 1.7 - t * 0.6),
                           sin(p.z * 1.1 - t * 0.7) + sin(p.x * 1.9 + t * 0.8),
                           sin(p.x * 1.4 + t * 0.5) + sin(p.y * 1.6 - t * 1.1));
          vec3 r = p + warp * 0.85;
          float field = sin(r.x * 0.9 + r.y * 1.2 - t * 1.4) * sin(r.y * 0.7 - r.z * 1.1 + t * 1.0);
          float vein = 1.0 - smoothstep(0.0, 0.1, abs(field));
          float halo = (1.0 - smoothstep(0.0, 0.45, abs(field))) * 0.35;
          // veins come and go in patches, so the piece is never covered evenly
          float patches = smoothstep(-0.2, 0.8, sin(dot(p, vec3(0.45, 0.6, 0.35)) - t * 0.6) + 0.35 * sin(p.x * 0.8 - p.y * 0.5 + t * 0.9));
          float energy = (vein + halo) * patches;
          // a wide highlight that runs from feet to head every few seconds
          float sweep = smoothstep(0.3, 0.0, abs(fract(vGlintPos.y * 0.45 - t * 0.35) - 0.5));
          vec3 base = gl_FragColor.rgb;
          float luma = dot(base, vec3(0.299, 0.587, 0.114));
          // keep the piece's own colours, pulled towards the metal
          vec3 tinted = mix(base, uGlintTint * (0.25 + luma * 1.5), 0.28);
          gl_FragColor.rgb = tinted + uGlintTint * (sheen * 0.09 + energy * 0.5 + sweep * 0.15);
        }
        #include <dithering_fragment>`);
  };
  return material;
}

function gearMaterials(gear: LoadedGear) {
  let set = materials.get(gear);
  if (!set) {
    set = [new THREE.MeshStandardMaterial({ map: gear.atlas, roughness: 0.9, metalness: 0 }), glintMaterial(gear.atlas, 1), glintMaterial(gear.atlas, 2)];
    materials.set(gear, set);
  }
  return set;
}

/** The material of all gear (the atlas), page-wide per loaded gear; `glint` picks the refined shimmer. */
export function gearMaterial(gear: LoadedGear, glint: RefineGlint = 0): THREE.MeshStandardMaterial {
  return gearMaterials(gear)[glint];
}

/** The gear mesh of one character: shared geometry and material, bound to that character's skeleton. */
export function gearMesh(geometry: THREE.BufferGeometry, gear: LoadedGear, skeleton: THREE.Skeleton, bindMatrix: THREE.Matrix4): THREE.SkinnedMesh {
  // geometry groups exist only when some piece is refined: then each group picks its material slot
  const mesh = new THREE.SkinnedMesh(geometry, geometry.groups.length ? gearMaterials(gear) : gearMaterial(gear));
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
