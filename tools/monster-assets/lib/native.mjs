/** Native monsters: keep the source rig, rename/cut/generate battle clips, normalize size and facing. */
import { mat4, quat, vec3 } from 'gl-matrix';

const BATTLE = ['Idle', 'Attack', 'Damage', 'Dead', 'Cast'];

function clipRange(anim) {
  let t0 = Infinity, t1 = 0;
  for (const s of anim.listSamplers()) { const a = s.getInput().getArray(); t0 = Math.min(t0, a[0]); t1 = Math.max(t1, a[a.length - 1]); }
  return [t0, t1];
}

/** New animation `name` made of the [t0, t1] slice of `anim` (keys inside the range, shifted to start at 0). */
export function sliceClip(doc, anim, t0, t1, name) {
  const buffer = doc.getRoot().listBuffers()[0];
  const out = doc.createAnimation(name);
  for (const ch of anim.listChannels()) {
    const s = ch.getSampler(); const inp = s.getInput().getArray(); const outp = s.getOutput();
    const size = (outp.getCount() * outp.getElementSize()) / inp.length; // per key (morph weights: N values; cubic: 3x)
    const keep = []; for (let i = 0; i < inp.length; i++) if (inp[i] >= t0 - 1e-4 && inp[i] <= t1 + 1e-4) keep.push(i);
    if (!keep.length) { let best = 0; for (let i = 0; i < inp.length; i++) if (inp[i] <= t0) best = i; keep.push(best); }
    const ti = new Float32Array(keep.map((i) => Math.max(0, inp[i] - t0)));
    const src = outp.getArray(); const to = new src.constructor(keep.length * size);
    keep.forEach((i, k) => to.set(src.subarray(i * size, (i + 1) * size), k * size));
    const ns = doc.createAnimationSampler().setInterpolation(s.getInterpolation())
      .setInput(doc.createAccessor().setType('SCALAR').setArray(ti).setBuffer(buffer))
      .setOutput(doc.createAccessor().setType(outp.getType()).setArray(to).setNormalized(outp.getNormalized()).setBuffer(buffer));
    out.addSampler(ns).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(ns));
  }
  return out;
}

/** Rest-pose world-space bounds of every mesh (skinned: sum w * joint * IBM * v, per the glTF spec). */
export function restBounds(doc) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const v = vec3.create(), acc = vec3.create(), tmp = vec3.create();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const skin = node.getSkin();
    const mats = skin ? skin.listJoints().map((j, i) => mat4.multiply(mat4.create(), j.getWorldMatrix(), skin.getInverseBindMatrices().getElement(i, []))) : null;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'); if (!pos) continue;
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const step = Math.max(1, Math.floor(pos.getCount() / 20000));
      for (let i = 0; i < pos.getCount(); i += step) {
        pos.getElement(i, v);
        if (mats && J && W) {
          const j = J.getElement(i, []), w = W.getElement(i, []); vec3.set(acc, 0, 0, 0);
          for (let k = 0; k < 4; k++) if (w[k]) { vec3.transformMat4(tmp, v, mats[j[k]]); vec3.scaleAndAdd(acc, acc, tmp, w[k]); }
          vec3.copy(v, acc);
        } else vec3.transformMat4(v, v, world);
        for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], v[a]); max[a] = Math.max(max[a], v[a]); }
      }
    }
  }
  return { min, max };
}

const deg = (d) => (d * Math.PI) / 180;
const qx = (d) => [...quat.setAxisAngle(quat.create(), [1, 0, 0], deg(d))];
const qz = (d) => [...quat.setAxisAngle(quat.create(), [0, 0, 1], deg(d))];

/** Generated clips on the top wrapper node (metres; the model faces +Z, feet at y=0). */
function generatedClip(doc, node, name, S) {
  const buffer = doc.getRoot().listBuffers()[0];
  const tracks = {
    Damage: { t: [0, 0.1, 0.4], T: [[0, 0, 0], [0, 0, -0.15], [0, 0, 0]], R: [qx(0), qx(-8), qx(0)] },
    Attack: { t: [0, 0.25, 0.7], T: [[0, 0, 0], [0, 0.03, Math.min(0.5, 0.2 * S)], [0, 0, 0]], R: [qx(0), qx(10), qx(0)] },
    Dead: { t: [0, 0.7, 1.4], T: [[0, 0, 0], [0, 0, 0], [0, -0.35 * S, 0]], R: [qz(0), qz(85), qz(85)] },
  }[name];
  const anim = doc.createAnimation(name);
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(tracks.t)).setBuffer(buffer);
  for (const [path, vals, type] of [['translation', tracks.T, 'VEC3'], ['rotation', tracks.R, 'VEC4']]) {
    const s = doc.createAnimationSampler().setInterpolation('LINEAR').setInput(input)
      .setOutput(doc.createAccessor().setType(type).setArray(new Float32Array(vals.flat())).setBuffer(buffer));
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(s));
  }
  return anim;
}

/** Same samplers' data under a new name (accessors shared). */
function aliasClip(doc, anim, name) {
  const out = doc.createAnimation(name);
  for (const ch of anim.listChannels()) {
    const s = ch.getSampler();
    const ns = doc.createAnimationSampler().setInterpolation(s.getInterpolation()).setInput(s.getInput()).setOutput(s.getOutput());
    out.addSampler(ns).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(ns));
  }
  return out;
}

/** Mutates doc in place. Returns { height, clips, generated }. */
export function buildNative(doc, id, cfg) {
  const root = doc.getRoot();
  const byName = new Map(root.listAnimations().map((a) => [a.getName(), a]));
  const want = { ...cfg.clips, ...(cfg.keep ?? {}) };
  for (const [name, [src, t0, t1]] of Object.entries(cfg.split ?? {})) {
    const a = byName.get(src); if (!a) throw new Error(`${id}: no clip ${src} to split`);
    sliceClip(doc, a, t0, t1, `__split_${name}`); want[name] = `__split_${name}`;
  }
  const fresh = new Map(root.listAnimations().map((a) => [a.getName(), a]));
  const made = new Map();
  for (const [ours, src] of Object.entries(want)) {
    const a = fresh.get(src); if (!a) throw new Error(`${id}: no clip "${src}" (have: ${[...fresh.keys()].join(', ')})`);
    const [t0, t1] = clipRange(a);
    made.set(ours, sliceClip(doc, a, t0, t1, ours)); // copy starting at 0 (also detaches shared accessors)
  }
  const kill = (a) => { for (const x of a.listSamplers()) x.dispose(); for (const x of a.listChannels()) x.dispose(); a.dispose(); };
  for (const a of root.listAnimations()) if (![...made.values()].includes(a)) kill(a);
  if (cfg.dropMorph) {
    for (const a of made.values()) for (const ch of a.listChannels()) if (ch.getTargetPath() === 'weights') { ch.getSampler().dispose(); ch.dispose(); }
    for (const m of root.listMeshes()) { m.setWeights([]); for (const p of m.listPrimitives()) for (const t of p.listTargets()) p.removeTarget(t); }
  }

  // wrappers: Monster (generated motion, metres) > Norm (scale/turn/ground) > original scene roots
  const scene = root.listScenes()[0];
  // measure in the first Idle frame (rest poses are often T-poses or coiled)
  for (const ch of made.get('Idle').listChannels()) {
    const p = ch.getTargetPath(); if (p === 'weights') continue;
    const v = ch.getSampler().getOutput().getElement(ch.getSampler().getInterpolation() === 'CUBICSPLINE' ? 1 : 0, []);
    const n = ch.getTargetNode(); if (p === 'translation') n.setTranslation(v); else if (p === 'rotation') n.setRotation(v); else n.setScale(v);
  }
  const { min, max } = restBounds(doc);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const turn = quat.setAxisAngle(quat.create(), [0, 1, 0], deg(cfg.rotY ?? 0));
  const k = cfg.size.h ? cfg.size.h / size[1] : cfg.size.len / Math.max(size[0], size[2]);
  const c = vec3.fromValues(-(min[0] + max[0]) / 2, -min[1] + (cfg.lift ?? 0) / Math.max(1e-9, cfg.size.h ? cfg.size.h / size[1] : cfg.size.len / Math.max(size[0], size[2])), -(min[2] + max[2]) / 2);
  vec3.transformQuat(c, vec3.scale(c, c, k), turn);
  const norm = doc.createNode('Norm').setScale([k, k, k]).setRotation([...turn]).setTranslation([...c]);
  const top = doc.createNode('Monster').addChild(norm);
  for (const n of scene.listChildren()) { scene.removeChild(n); norm.addChild(n); }
  scene.addChild(top);
  // skinned meshes: scene roots with identity transform, so three.js and the glTF spec agree (joints carry the wrappers)
  for (const n of root.listNodes()) if (n.getSkin() && n.getMesh()) {
    const parent = n.getParentNode();
    if (parent) { parent.removeChild(n); for (const c of n.listChildren()) { n.removeChild(c); parent.addChild(c); } }
    n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    scene.addChild(n);
  }

  const S = cfg.size.h ?? cfg.size.len;
  const generated = [];
  for (const g of ['Attack', 'Damage', 'Dead']) if (!made.has(g)) { made.set(g, generatedClip(doc, top, g, S)); generated.push(g); }
  if (!made.has('Cast')) made.set('Cast', aliasClip(doc, made.get('Attack'), 'Cast'));

  for (const a of cfg.attach ?? []) attachCones(doc, a);
  for (const m of root.listMaterials()) {
    if (!cfg.tint) break;
    const f = m.getBaseColorFactor(); m.setBaseColorFactor([f[0] * cfg.tint[0], f[1] * cfg.tint[1], f[2] * cfg.tint[2], f[3]]);
  }
  return { height: +(size[1] * k).toFixed(2), clips: [...made.keys()].sort((a, b) => (BATTLE.indexOf(a) + 1 || 99) - (BATTLE.indexOf(b) + 1 || 99)), generated };
}

/**
 * Cones fixed to bones (horn, back spines). a = { bone: RegExp, every?: n, length, radius, dir: [x,y,z] (world),
 * offset: [x,y,z] metres (world), color: [r,g,b], spread?: metres (2 cones per bone side by side) }.
 * Placed in the rest/Idle-frame world (metres, facing +Z) and re-expressed in the bone's local space.
 */
function attachCones(doc, a) {
  const root = doc.getRoot(); const buffer = root.listBuffers()[0];
  const bones = root.listNodes().filter((n) => a.bone.test(n.getName())).filter((_, i) => i % (a.every ?? 1) === 0);
  if (!bones.length) throw new Error(`attach: no bone matches ${a.bone}`);
  const N = 8, pos = [0, 1, 0], idx = [];
  for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2; pos.push(Math.cos(t), 0, Math.sin(t)); }
  for (let i = 0; i < N; i++) idx.push(0, 1 + ((i + 1) % N), 1 + i);
  for (let i = 1; i < N - 1; i++) idx.push(1, 1 + i, 2 + i);
  const mat = doc.createMaterial('Attach').setBaseColorFactor([...a.color, 1]).setRoughnessFactor(0.6).setMetallicFactor(0);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer));
  const mesh = doc.createMesh('Cone').addPrimitive(prim);
  const dir = vec3.normalize(vec3.create(), a.dir);
  const rot = quat.rotationTo(quat.create(), [0, 1, 0], dir);
  for (const b of bones) {
    const bw = b.getWorldMatrix(); const bp = mat4.getTranslation(vec3.create(), bw);
    for (const side of a.spread ? [-1, 1] : [0]) {
      const p = vec3.add(vec3.create(), bp, a.offset ?? [0, 0, 0]); p[0] += side * (a.spread ?? 0);
      const world = mat4.fromRotationTranslationScale(mat4.create(), rot, p, [a.radius, a.length, a.radius]);
      const local = mat4.multiply(mat4.create(), mat4.invert(mat4.create(), bw), world);
      const t = mat4.getTranslation(vec3.create(), local), r = mat4.getRotation(quat.create(), local), sc = mat4.getScaling(vec3.create(), local);
      b.addChild(doc.createNode('Cone').setMesh(mesh).setTranslation([...t]).setRotation([...quat.normalize(r, r)]).setScale([...sc]));
    }
  }
}
