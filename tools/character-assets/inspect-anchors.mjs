#!/usr/bin/env node
/**
 * Development aid: for each overlay anchor, prints where it falls in the skin
 * texture (1024 px), how many texture pixels one centimetre covers and which
 * texture direction points "up" on the body. Used to fill BODY_LAYOUT in the
 * viewer.   node inspect-anchors.mjs ../../apps/frontend/public/assets/character/body-male.glb
 */
import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const root = doc.getRoot();
const bone = (name) => { const m = root.listNodes().find((n) => n.getName() === name).getWorldMatrix(); return [m[12], m[13], m[14]]; };
const prim = root.listNodes().find((n) => n.getName() === 'Body').getMesh().listPrimitives()[0];
const P = prim.getAttribute('POSITION'), T = prim.getAttribute('TEXCOORD_0'), N = prim.getAttribute('NORMAL');
const verts = [];
for (let i = 0; i < P.getCount(); i++) verts.push({ p: P.getElement(i, []), t: T.getElement(i, []).map((x) => x * 1024), n: N.getElement(i, []) });
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Surface point nearest to `q` whose normal faces `facing`. */
function surface(q, facing) {
  let best = null, bestD = Infinity;
  for (const v of verts) {
    if (dot(v.n, facing) < 0.4) continue;
    const d = Math.hypot(...sub(v.p, q));
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}
function report(label, q, facing, up) {
  const v = surface(q, facing);
  const a = surface(add(v.p, mul(up, 0.03)), facing);
  const du = sub(a.t, v.t);
  const pxPerCm = Math.hypot(du[0], du[1]) / 3;
  const angle = Math.atan2(du[1], du[0]) * 180 / Math.PI;
  console.log(`${label.padEnd(10)} uv ${v.t.map((x) => x.toFixed(0)).join(',')}  ${pxPerCm.toFixed(1)} px/cm  body-up points to ${angle.toFixed(0)}° in texture  xyz ${v.p.map((x) => x.toFixed(3)).join(',')}`);
}
const uaL = bone('upperarm_l'), laL = bone('lowerarm_l'), spine = bone('spine_03'), neck = bone('neck_01'), head = bone('Head');
const armMid = mul(add(uaL, laL), 0.5);
const armDir = sub(uaL, laL); const armLen = Math.hypot(...armDir); const armUp = mul(armDir, 1 / armLen);
report('upperArmL', add(armMid, [0, 0, 0.06]), [0, 0, 1], armUp);
report('shoulderL', add(uaL, [0.02, 0.06, 0.02]), [0, 1, 0], [0, 0, -1]);
const chestY = (spine[1] + neck[1]) / 2;
report('chestL', [0.10, chestY, 0.2], [0, 0, 1], [0, 1, 0]);
report('cheekL', [0.05, head[1] + 0.06, 0.15], [0, 0, 1], [0, 1, 0]);
console.log('bones', JSON.stringify({ upperarm_l: uaL.map((x) => +x.toFixed(3)), lowerarm_l: laL.map((x) => +x.toFixed(3)), spine_03: spine.map((x) => +x.toFixed(3)), neck_01: neck.map((x) => +x.toFixed(3)), Head: head.map((x) => +x.toFixed(3)) }));
