/** Body regions by bone, and triangle filters over gltf-transform primitives. */

/** @typedef {'head'|'neck'|'torso'|'upperarms'|'forearms'|'hands'|'thighs'|'calves'|'feet'} Region */
export const REGIONS = ['head', 'neck', 'torso', 'upperarms', 'forearms', 'hands', 'thighs', 'calves', 'feet'];

/** @returns {Region} */
export function REGION_OF_BONE(name) {
  if (name === 'Head') return 'head';
  if (name === 'neck_01') return 'neck';
  if (/^upperarm_/.test(name)) return 'upperarms';
  if (/^lowerarm_/.test(name)) return 'forearms';
  if (/^(hand|thumb|index|middle|ring|pinky)_/.test(name)) return 'hands';
  if (/^thigh_/.test(name)) return 'thighs';
  if (/^calf_/.test(name)) return 'calves';
  if (/^(foot|ball)_/.test(name)) return 'feet';
  return 'torso'; // root, pelvis, spine_0x, clavicle_x
}

/** Keeps the triangles `keep([a,b,c])` accepts; rewrites the index accessor. Returns how many were kept. */
export function filterTriangles(prim, keep) {
  const P = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const all = idx ? Array.from(idx.getArray()) : [...Array(P.getCount()).keys()];
  const kept = [];
  for (let i = 0; i < all.length; i += 3) {
    const tri = [all[i], all[i + 1], all[i + 2]];
    if (keep(tri)) kept.push(...tri);
  }
  const array = P.getCount() > 65535 ? new Uint32Array(kept) : new Uint16Array(kept);
  if (idx) idx.setArray(array);
  else prim.setIndices(prim.getAttribute('POSITION').clone().setType('SCALAR').setArray(array));
  return kept.length / 3;
}

/** Rejects triangles with any vertex outside a generous box around our body (helper meshes left far away). */
export function strayFilter(positions) {
  const out = (v) => {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    return y > 2.1 || y < -0.3 || Math.abs(x) > 1.3 || Math.abs(z) > 1.0;
  };
  return (tri) => !tri.some(out);
}
