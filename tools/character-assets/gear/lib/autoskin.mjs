/**
 * Static (unrigged) humanoid mesh -> weighted to OUR joints, in OUR rest pose.
 *
 * Our rest pose is a T-pose. armDeg/legDeg pose our arms down / legs apart to match the model;
 * the model is fitted (height, bbox centre) onto that posed body; each vertex takes the blended
 * weights of the 4 nearest posed-body vertices and is un-posed by the inverse blended skin matrix.
 */
import { mat3, mat4, vec3 } from 'gl-matrix';
import { readTargetBody } from './skeleton.mjs';

export async function autoskinStatic(doc, target, { armDeg = 0, legDeg = 0, rotYDeg = 0, fit = true } = {}) {
  const body = await readTargetBody(target.sex);
  const names = target.joints.map((j) => j.name);
  const parent = new Map(target.joints.map((j) => [j.name, j.parent]));
  const under = (name, anc) => { for (let p = name; p; p = parent.get(p)) if (p === anc) return true; return false; };
  const posed = target.joints.map((j) => mat4.clone(j.world));
  const rotateBranch = (rootName, deg) => {
    if (!deg) return;
    const pivot = target.pos(rootName);
    const R = mat4.create();
    mat4.translate(R, R, pivot); mat4.rotateZ(R, R, (deg * Math.PI) / 180); mat4.translate(R, R, vec3.negate(vec3.create(), pivot));
    names.forEach((n, i) => { if (under(n, rootName)) mat4.multiply(posed[i], R, posed[i]); });
  };
  // +X is the character's left: lowering the left arm turns it clockwise seen from the front (-Z rotation).
  rotateBranch('upperarm_l', -armDeg); rotateBranch('upperarm_r', armDeg);
  rotateBranch('thigh_l', legDeg); rotateBranch('thigh_r', -legDeg);
  const S = posed.map((m, i) => mat4.multiply(mat4.create(), m, target.joints[i].ibm));

  // posed body + grid
  const bp = new Float32Array(body.count * 3);
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < body.count; v++) {
    const p = body.positions.subarray(v * 3, v * 3 + 3), acc = vec3.create();
    for (let i = 0; i < 4; i++) { const w = body.weights[v * 4 + i]; if (w) vec3.scaleAndAdd(acc, acc, vec3.transformMat4(vec3.create(), p, S[body.joints[v * 4 + i]]), w); }
    bp.set(acc, v * 3);
    for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], acc[k]); bmax[k] = Math.max(bmax[k], acc[k]); }
  }
  const CELL = 0.05, grid = new Map();
  const cell = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  for (let v = 0; v < body.count; v++) { const k = cell(bp[v * 3], bp[v * 3 + 1], bp[v * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)).push(v); }
  const nearest = (p, n = 4) => {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
    for (let r = 1; r < 60; r++) {
      const found = [];
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        for (const v of grid.get(`${x},${y},${z}`) ?? []) found.push([v, (bp[v * 3] - p[0]) ** 2 + (bp[v * 3 + 1] - p[1]) ** 2 + (bp[v * 3 + 2] - p[2]) ** 2]);
      }
      if (found.length >= n) return found.sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, n);
    }
    return [];
  };

  // fit the model onto the posed body
  const root = doc.getRoot();
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  const ry = mat4.fromYRotation(mat4.create(), (rotYDeg * Math.PI) / 180);
  const world = new Map(meshNodes.map((n) => [n, mat4.multiply(mat4.create(), ry, n.getWorldMatrix())]));
  const align = mat4.create();
  if (fit) {
    const smin = [Infinity, Infinity, Infinity], smax = [-Infinity, -Infinity, -Infinity];
    for (const n of meshNodes) for (const pr of n.getMesh().listPrimitives()) {
      const P = pr.getAttribute('POSITION');
      for (let i = 0; i < P.getCount(); i++) { const v = vec3.transformMat4(vec3.create(), P.getElement(i, []), world.get(n)); for (let k = 0; k < 3; k++) { smin[k] = Math.min(smin[k], v[k]); smax[k] = Math.max(smax[k], v[k]); } }
    }
    const s = (bmax[1] - bmin[1]) / (smax[1] - smin[1]);
    mat4.translate(align, align, [((bmin[0] + bmax[0]) - (smin[0] + smax[0]) * s) / 2, bmin[1] - smin[1] * s, ((bmin[2] + bmax[2]) - (smin[2] + smax[2]) * s) / 2]);
    mat4.scale(align, align, [s, s, s]);
  }

  const dominant = new Map();
  const done = new Set();
  for (const n of meshNodes) {
    const M = mat4.multiply(mat4.create(), align, world.get(n));
    const nm = mat3.normalFromMat4(mat3.create(), M);
    for (const pr of n.getMesh().listPrimitives()) {
      if (done.has(pr)) continue;
      done.add(pr);
      const P = pr.getAttribute('POSITION'), N = pr.getAttribute('NORMAL');
      const count = P.getCount();
      const pos = new Float32Array(count * 3), nor = N ? new Float32Array(count * 3) : null;
      const nj = new Uint16Array(count * 4), nw = new Float32Array(count * 4), dom = new Int32Array(count);
      for (let v = 0; v < count; v++) {
        const p = vec3.transformMat4(vec3.create(), P.getElement(v, []), M);
        const tw = new Map();
        for (const [bv, d2] of nearest(p)) {
          const f = 1 / (Math.sqrt(d2) + 0.005);
          for (let i = 0; i < 4; i++) { const w = body.weights[bv * 4 + i]; if (w) { const j = body.joints[bv * 4 + i]; tw.set(j, (tw.get(j) ?? 0) + w * f); } }
        }
        const top = [...tw.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
        const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
        const skinM = new Float32Array(16);
        top.forEach(([j, w], i) => { nj[v * 4 + i] = j; nw[v * 4 + i] = w / sum; for (let k = 0; k < 16; k++) skinM[k] += S[j][k] * (w / sum); });
        dom[v] = top[0]?.[0] ?? 0;
        const inv = mat4.invert(mat4.create(), skinM) ?? mat4.create();
        pos.set(vec3.transformMat4(vec3.create(), p, inv), v * 3);
        if (N) {
          const nn = vec3.transformMat3(vec3.create(), N.getElement(v, []), nm);
          vec3.transformMat3(nn, nn, mat3.normalFromMat4(mat3.create(), inv));
          nor.set(vec3.normalize(nn, nn), v * 3);
        }
      }
      P.setArray(pos);
      if (N) N.setArray(nor);
      const buffer = P.getBuffer();
      pr.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(nj).setBuffer(buffer));
      pr.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(nw).setBuffer(buffer));
      dominant.set(pr, dom);
    }
  }
  return { primitives: [...done], dominant };
}
