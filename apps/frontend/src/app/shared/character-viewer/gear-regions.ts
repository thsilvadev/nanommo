/** Which parts of the body show under a character's gear. */
import * as THREE from 'three';
import type { Sex } from '@nanommo/shared';
import type { HideBand, Region } from './gear-manifest';

/** Same table as tools/character-assets/gear/lib/regions.mjs. */
export function boneRegion(name: string): Region {
  if (name === 'Head') return 'head';
  if (name === 'neck_01') return 'neck';
  if (/^upperarm_/.test(name)) return 'upperarms';
  if (/^lowerarm_/.test(name)) return 'forearms';
  if (/^(hand|thumb|index|middle|ring|pinky)_/.test(name)) return 'hands';
  if (/^thigh_/.test(name)) return 'thighs';
  if (/^calf_/.test(name)) return 'calves';
  if (/^(foot|ball)_/.test(name)) return 'feet';
  return 'torso';
}

const cache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
const originals = new WeakMap<THREE.SkinnedMesh, THREE.BufferGeometry>();

/**
 * The body's geometry with the hidden triangles left out of the index (attributes shared, so
 * per-character deformation still applies). A vertex is hidden when its dominant bone's region is
 * covered, or when it lies inside a shell's band (a calves band also takes the knee's thigh
 * vertices); a triangle goes when all three of its vertices are hidden. Head and neck never hide.
 * Cached per source geometry and (sex, covered, bands); nothing hidden -> the original geometry.
 */
export function visibleBodyGeometry(sex: Sex, body: THREE.SkinnedMesh, covered: ReadonlySet<Region>, bands: readonly HideBand[]): THREE.BufferGeometry {
  if (!originals.has(body)) originals.set(body, body.geometry);
  const source = originals.get(body)!;
  if (!covered.size && !bands.length) return source;
  const key = `${sex}|${[...covered].sort().join(',')}|${JSON.stringify(bands)}`;
  let byKey = cache.get(source);
  if (!byKey) cache.set(source, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;

  const J = source.getAttribute('skinIndex'), W = source.getAttribute('skinWeight'), P = source.getAttribute('position');
  const regions = body.skeleton.bones.map((b) => boneRegion(b.name));
  const hidden = new Uint8Array(P.count);
  for (let v = 0; v < P.count; v++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (W.getComponent(v, k) > W.getComponent(v, best)) best = k;
    const region = regions[J.getComponent(v, best)];
    if (region === 'head' || region === 'neck') continue;
    const y = P.getY(v);
    hidden[v] = covered.has(region) || bands.some((b) => (region === b.region || (b.region === 'calves' && region === 'thighs')) && y > b.minY && y < b.maxY) ? 1 : 0;
  }
  const index = source.getIndex()!;
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (!(hidden[a] && hidden[b] && hidden[c])) kept.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(kept);
  geometry.boundingSphere = source.boundingSphere;
  geometry.boundingBox = source.boundingBox;
  byKey.set(key, geometry);
  return geometry;
}
