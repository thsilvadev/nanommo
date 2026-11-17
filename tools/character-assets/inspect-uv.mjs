#!/usr/bin/env node
/**
 * Development aid: prints where face/body landmarks sit in 3D and in the skin
 * texture (pixels of a 1024 texture), for placing overlays and deformations.
 *   node inspect-uv.mjs ../../apps/frontend/public/assets/character/body-male.glb
 */
import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const node = doc.getRoot().listNodes().find((n) => n.getName() === 'Body');
const prim = node.getMesh().listPrimitives()[0];
const P = prim.getAttribute('POSITION'), T = prim.getAttribute('TEXCOORD_0'), N = prim.getAttribute('NORMAL');
const verts = [];
for (let i = 0; i < P.getCount(); i++) { const p = P.getElement(i, []), t = T.getElement(i, []), n = N.getElement(i, []); verts.push({ i, x: p[0], y: p[1], z: p[2], u: Math.round(t[0] * 1024), v: Math.round(t[1] * 1024), nz: n[2] }); }
const f = (n) => n.toFixed(3);
const show = (label, list) => { console.log(`-- ${label}`); for (const v of list) console.log(`   xyz ${f(v.x)} ${f(v.y)} ${f(v.z)}  uv ${v.u},${v.v}`); };
const near = (x, y, z, k = 1) => [...verts].sort((a, b) => Math.hypot(a.x - x, a.y - y, a.z - z) - Math.hypot(b.x - x, b.y - y, b.z - z)).slice(0, k);
const top = Math.max(...verts.map((v) => v.y));
console.log('top', f(top));
// Face midline profile, front side, from chin up to the forehead.
const mid = verts.filter((v) => Math.abs(v.x) < 0.004 && v.z > 0.02 && v.y > top - 0.30).sort((a, b) => b.y - a.y);
show('midline profile (top -> down)', mid.filter((_, i) => i % 2 === 0));
const tip = verts.filter((v) => v.y > top - 0.25 && v.y < top - 0.08 && Math.abs(v.x) < 0.03).sort((a, b) => b.z - a.z)[0];
show('nose tip (front-most point of the face)', [tip]);
if (process.argv[3]) { const [x, y, z] = process.argv[3].split(',').map(Number); show(`nearest to ${process.argv[3]}`, near(x, y, z, 4)); }
