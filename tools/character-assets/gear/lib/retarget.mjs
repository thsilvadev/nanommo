/**
 * Rigged source (any humanoid rig we can map) -> vertices in OUR rest pose, weighted to OUR joints.
 *
 * 1. Bind-pose vertices in world space: joint world x IBM x v.
 * 2. Global facing (thighs + upper arms, flattened on Y) and height scale.
 * 3. Per target bone: move the source bone's head onto ours, turn its direction onto ours
 *    (shortest arc), stretch along the bone (0.75..1.35) and apply optional per-bone shrink.
 * 4. Linear-blend vertices with those transforms; weights rewritten onto our joint indices.
 * Bones without a mapped ancestor (Rigify tweak/scarf bones hang from ROOT) follow the
 * nearest mapped bone.
 */
import { mat3, mat4, quat, vec3 } from 'gl-matrix';
import { mapSourceBones } from './bones.mjs';

const KEY_BONES = ['pelvis', 'Head', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r',
  'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];

const CHAIN_CHILD = { pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'Head' };
for (const s of ['l', 'r']) {
  Object.assign(CHAIN_CHILD, {
    [`clavicle_${s}`]: `upperarm_${s}`, [`upperarm_${s}`]: `lowerarm_${s}`, [`lowerarm_${s}`]: `hand_${s}`, [`hand_${s}`]: `middle_01_${s}`,
    [`thigh_${s}`]: `calf_${s}`, [`calf_${s}`]: `foot_${s}`, [`foot_${s}`]: `ball_${s}`,
  });
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    CHAIN_CHILD[`${f}_01_${s}`] = `${f}_02_${s}`;
    CHAIN_CHILD[`${f}_02_${s}`] = `${f}_03_${s}`;
  }
}

/**
 * opts.scale: { hand: {f: 0.55, perp: false}, upperarm: {f: 0.75, perp: true}, spine_03: {xyz: [1.15, 1, 1]} }
 * (applies to _l and _r and descendants; xyz: per bind-space axis, X across, Z front-back).
 */
export function retargetSkinned(doc, target, opts = {}) {
  const root = doc.getRoot();
  const skinned = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  if (!skinned.length) throw new Error('no skinned mesh');
  const sJoints = [...new Set(skinned.flatMap((n) => n.getSkin().listJoints()))];
  const sWorld = new Map(sJoints.map((j) => [j, j.getWorldMatrix()]));
  const sPosOf = (j) => mat4.getTranslation(vec3.create(), sWorld.get(j));
  const map = mapSourceBones(sJoints, new Set(target.index.keys()));
  const byTarget = new Map([...map].map(([j, t]) => [t, j]));
  const missing = KEY_BONES.filter((t) => !byTarget.has(t));
  if (missing.length) throw new Error(`missing key bones: ${missing.join(', ')}`);
  const sp = (t) => sPosOf(byTarget.get(t));
  const tp = (t) => target.pos(t);

  // global facing + scale
  const mid = (pos, a, b) => vec3.lerp(vec3.create(), pos(a), pos(b), 0.5);
  const k = (tp('Head')[1] - mid(tp, 'foot_l', 'foot_r')[1]) / (sp('Head')[1] - mid(sp, 'foot_l', 'foot_r')[1]);
  const leftAxis = (pos) => {
    const v = vec3.add(vec3.create(), vec3.sub(vec3.create(), pos('thigh_l'), pos('thigh_r')), vec3.sub(vec3.create(), pos('upperarm_l'), pos('upperarm_r')));
    return vec3.normalize(v, vec3.fromValues(v[0], 0, v[2]));
  };
  const G = quat.rotationTo(quat.create(), leftAxis(sp), leftAxis(tp));
  const gk = mat4.fromRotationTranslationScale(mat4.create(), G, [0, 0, 0], [k, k, k]);
  const toG = (v) => vec3.transformMat4(vec3.create(), v, gk);

  const chainTail = (t, pos) => { for (let c = CHAIN_CHILD[t]; c; c = CHAIN_CHILD[c]) if (byTarget.has(c)) return pos(c); return null; };
  const parentOf = new Map(target.joints.map((j) => [j.name, j.parent]));
  const scaleSpec = opts.scale ?? {};
  const X = new Map();
  for (const { name: t } of target.joints) { // parents first
    if (!byTarget.has(t)) continue;
    const sHead = toG(sp(t)), tHead = tp(t);
    const sTail = chainTail(t, sp), tTail = chainTail(t, tp);
    let r = quat.create(), stretch = 1, axis = vec3.fromValues(0, 1, 0);
    if (sTail && tTail) {
      const sDir = vec3.sub(vec3.create(), toG(sTail), sHead);
      const tDir = vec3.sub(vec3.create(), tTail, tHead);
      stretch = Math.min(1.35, Math.max(0.75, vec3.length(tDir) / vec3.length(sDir)));
      vec3.normalize(axis, tDir);
      r = quat.rotationTo(quat.create(), vec3.normalize(sDir, sDir), axis);
    } else {
      let p = parentOf.get(t);
      while (p && !X.has(p)) p = parentOf.get(p);
      if (p) r = quat.clone(X.get(p).rLocal);
    }
    const S = axial(axis, stretch);
    const m = mat4.create();
    mat4.translate(m, m, tHead);
    mat4.multiply(m, m, S);
    mat4.multiply(m, m, mat4.fromQuat(mat4.create(), r));
    mat4.translate(m, m, vec3.negate(vec3.create(), sHead));
    mat4.multiply(m, m, gk);
    // per-bone shrink about the nearest specified ancestor-or-self joint
    for (let a = t; a; a = parentOf.get(a)) {
      const spec = scaleSpec[a.replace(/_[lr]$/, '')];
      if (!spec) continue;
      const pivot = tp(a);
      const tail = chainTail(a, tp);
      const ax = tail ? vec3.normalize(vec3.create(), vec3.sub(vec3.create(), tail, pivot)) : vec3.fromValues(0, 1, 0);
      const Sc = spec.xyz ? mat4.fromScaling(mat4.create(), spec.xyz)
        : spec.perp ? perpScale(ax, spec.f) : mat4.fromScaling(mat4.create(), [spec.f, spec.f, spec.f]);
      const P = mat4.create();
      mat4.translate(P, P, pivot); mat4.multiply(P, P, Sc); mat4.translate(P, P, vec3.negate(vec3.create(), pivot));
      mat4.multiply(m, P, m);
      break;
    }
    X.set(t, { m, rLocal: r, rot: quat.multiply(quat.create(), r, G) });
  }

  const nearestMapped = (j) => {
    for (let p = j; p; p = p.getParentNode()) if (map.has(p)) return map.get(p);
    const at = sPosOf(j); let best = 'pelvis', bd = Infinity;
    for (const [t, sj] of byTarget) { const d = vec3.distance(at, sPosOf(sj)); if (d < bd) { bd = d; best = t; } }
    return best;
  };

  const done = new Set();
  const dominant = new Map();
  const sourceDominant = new Map();
  for (const node of skinned) {
    const skin = node.getSkin();
    const joints = skin.listJoints();
    const ibm = skin.getInverseBindMatrices();
    const jm = joints.map((j, i) => mat4.multiply(mat4.create(), sWorld.get(j), ibm ? ibm.getElement(i, []) : mat4.create()));
    const jn = joints.map((j, i) => mat3.normalFromMat4(mat3.create(), jm[i]));
    const jTarget = joints.map(nearestMapped);
    for (const prim of node.getMesh().listPrimitives()) {
      if (done.has(prim)) continue;
      done.add(prim);
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL');
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const count = P.getCount();
      const pos = new Float32Array(count * 3), nor = N ? new Float32Array(count * 3) : null;
      const nj = new Uint16Array(count * 4), nw = new Float32Array(count * 4), dom = new Int32Array(count);
      const srcDom = new Array(count);
      for (let v = 0; v < count; v++) {
        const p = P.getElement(v, []), n = N?.getElement(v, []), js = J.getElement(v, []), ws = W.getElement(v, []);
        const sum = ws.reduce((a, b) => a + b, 0) || 1;
        const acc = vec3.create(), accN = vec3.create(), tw = new Map();
        let bi = 0;
        for (let i = 0; i < 4; i++) {
          if (ws[i] > ws[bi]) bi = i;
          const w = ws[i] / sum; if (!w) continue;
          const x = X.get(jTarget[js[i]]);
          vec3.scaleAndAdd(acc, acc, vec3.transformMat4(vec3.create(), vec3.transformMat4(vec3.create(), p, jm[js[i]]), x.m), w);
          if (n) vec3.scaleAndAdd(accN, accN, vec3.transformQuat(vec3.create(), vec3.transformMat3(vec3.create(), n, jn[js[i]]), x.rot), w);
          const ti = target.index.get(jTarget[js[i]]);
          tw.set(ti, (tw.get(ti) ?? 0) + w);
        }
        srcDom[v] = joints[js[bi]].getName();
        pos.set(acc, v * 3);
        if (nor) nor.set(vec3.normalize(accN, accN), v * 3);
        const top = [...tw.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
        const s = top.reduce((a, [, w]) => a + w, 0) || 1;
        top.forEach(([ti, w], i) => { nj[v * 4 + i] = ti; nw[v * 4 + i] = w / s; });
        dom[v] = top[0]?.[0] ?? 0;
      }
      P.setArray(pos);
      if (N) N.setArray(nor);
      const buffer = P.getBuffer();
      prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(nj).setBuffer(buffer));
      prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(nw).setBuffer(buffer));
      for (const sem of prim.listSemantics()) if (/^(JOINTS|WEIGHTS)_[1-9]/.test(sem)) prim.setAttribute(sem, null);
      for (const t of prim.listTargets()) prim.removeTarget(t);
      dominant.set(prim, dom);
      sourceDominant.set(prim, srcDom);
    }
  }
  return { primitives: [...done], dominant, sourceDominant, report: { mapped: byTarget.size, missing: [] } };
}

function axial(axis, s) {
  const m = mat4.create();
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a * 4 + b] = (a === b ? 1 : 0) + (s - 1) * axis[a] * axis[b];
  return m;
}
function perpScale(axis, f) {
  const m = mat4.create();
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a * 4 + b] = (a === b ? f : 0) + (1 - f) * axis[a] * axis[b];
  return m;
}
