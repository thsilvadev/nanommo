#!/usr/bin/env node
/**
 * Builds the wearable gear: source models -> our skeleton -> one atlas -> four files + manifest.
 *
 *   cd tools/character-assets && node gear/fetch-sources.mjs && node gear/build-gear.mjs [--only a,b] [--review <slot>]
 *
 * Outputs (apps/frontend/public/assets/character/gear/, or $GEAR_OUT):
 *   gear-male.glb / gear-female.glb  skinned visuals (one node + mesh per visual, our 65 joints, no textures)
 *   gear-rigid.glb                   rigid visuals (one node per visual, pivot at the origin)
 *   gear-atlas.webp                  every visual's texture; UVs already point into it
 *   manifest.json                    item -> visual, visual -> slot/kind/covers/…
 *   build-report.json                triangles and atlas texels per visual, total bytes
 * Reproducible: same sources -> byte-identical files.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { mat4, quat, vec3 } from 'gl-matrix';
import { ITEMS, VISUALS, SOURCES } from './gear.config.mjs';
import { CHARACTER_ASSETS, readTargetSkeleton, writeSkeleton } from './lib/skeleton.mjs';
import { retargetSkinned } from './lib/retarget.mjs';
import { autoskinStatic } from './lib/autoskin.mjs';
import { REGION_OF_BONE, strayFilter } from './lib/regions.mjs';
import { encodeAtlas, packAtlas } from './lib/atlas.mjs';
import { readObj } from './lib/obj.mjs';
import { smoothBladeEdge } from './lib/blade.mjs';
import { simplifyTo } from './lib/simplify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, '../source');
const OUT = process.env.GEAR_OUT ?? path.join(CHARACTER_ASSETS, 'gear');
const MAX_FOLDER_BYTES = 12 * 1024 * 1024;
const SEXES = ['male', 'female'];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1]; };
const only = arg('only')?.split(',') ?? null;
const review = arg('review');
const visualIds = Object.keys(VISUALS).filter((v) => !only || only.includes(v)).sort();

// ---------------------------------------------------------------- sources

const PLACEHOLDER = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } }).png().toBuffer();
let quaterniusDir = null;
function quaternius() {
  if (!quaterniusDir) {
    const base = path.resolve(here, '../../npc-assets/source/modular-character-outfits-fantasy');
    const pack = fs.readdirSync(base).find((d) => d.startsWith('Modular Character Outfits'));
    quaterniusDir = path.join(base, pack);
  }
  return quaterniusDir;
}
function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, name); if (hit) return hit; } else if (e.name === name) return p;
  }
  return null;
}
async function readGltf(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  const resources = {};
  for (const b of json.buffers ?? []) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(dir, decodeURIComponent(b.uri))));
  for (const im of json.images ?? []) {
    const name = decodeURIComponent(im.uri);
    const hit = fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : findFile(quaternius(), path.basename(name));
    resources[im.uri] = new Uint8Array(hit ? fs.readFileSync(hit) : PLACEHOLDER);
  }
  return io.readJSON({ json, resources });
}
/** Source documents for one visual and sex (fresh copies: the methods mutate them). */
async function loadSources(v, sex) {
  if (v.source === 'quaternius') {
    const dir = path.join(quaternius(), 'Exports/glTF (Godot-Unreal)/Modular Parts');
    return Promise.all(v.files[sex].map((f) => readGltf(path.join(dir, `${f}.gltf`))));
  }
  const [kind, id] = v.source.split(':');
  if (kind === 'sketchfab') {
    const file = path.join(SOURCE, 'sketchfab', id, 'model.glb');
    if (!fs.existsSync(file)) throw new Error(`missing ${file}: run node gear/fetch-sources.mjs`);
    return [await io.read(file)];
  }
  if (kind === 'weapons') {
    const dir = path.join(SOURCE, 'medieval-weapons');
    const pack = fs.readdirSync(dir, { withFileTypes: true }).find((e) => e.isDirectory()).name;
    return [readObj(path.join(dir, pack, 'OBJ', `${id}.obj`), id)];
  }
  if (kind === 'kaykit-asset') {
    const [, pack, file] = v.source.split(':');
    const base = path.join(SOURCE, pack === 'adventurers' ? 'kaykit-adventurers/repo' : 'kaykit-Skeletons', 'addons');
    const hit = findFile(base, file);
    if (!hit) throw new Error(`missing KayKit ${file}`);
    return [await io.read(hit)];
  }
  if (kind === 'kaykit') {
    const [, pack, file] = v.source.split(':');
    const base = path.join(SOURCE, pack === 'adventurers' ? 'kaykit-adventurers/repo' : 'kaykit-Skeletons', 'addons');
    const hit = findFile(base, file);
    if (!hit) throw new Error(`missing KayKit ${file}: run node gear/fetch-sources.mjs`);
    return [await io.read(hit)];
  }
  throw new Error(`unknown source ${v.source}`);
}

// ---------------------------------------------------------------- pieces

const hideBands = {}; // visual id -> sex -> [{ region, minY, maxY }] (bind-pose heights)
const round3 = (x) => Math.round(x * 1000) / 1000;

export function linearToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; }

/** A primitive as plain arrays in our bind space + its material. */
function toPiece(prim, dominant, sourceDominant) {
  const read = (sem) => prim.getAttribute(sem);
  const P = read('POSITION'), N = read('NORMAL'), T = read('TEXCOORD_0'), J = read('JOINTS_0'), W = read('WEIGHTS_0');
  const n = P.getCount();
  const arr = (acc, size, Type) => { const a = new Type(n * size); for (let i = 0; i < n; i++) a.set(acc.getElement(i, []), i * size); return a; };
  const material = prim.getMaterial();
  const texture = material?.getBaseColorTexture();
  return {
    position: arr(P, 3, Float32Array),
    normal: N ? arr(N, 3, Float32Array) : null,
    uv: T ? arr(T, 2, Float32Array) : new Float32Array(n * 2).fill(0.5),
    joints: J ? arr(J, 4, Uint16Array) : new Uint16Array(n * 4),
    weights: W ? arr(W, 4, Float32Array) : new Float32Array(n * 4),
    index: prim.getIndices() ? Array.from(prim.getIndices().getArray()) : [...Array(n).keys()],
    dominant, sourceDominant,
    material: {
      name: material?.getName() ?? '',
      image: texture ? Buffer.from(texture.getImage()) : null,
      // glTF colour factors are linear; the atlas stores sRGB texels
      color: material ? material.getBaseColorFactor().slice(0, 3).map(linearToSrgb) : [1, 1, 1],
    },
  };
}

function filterPiece(piece, v, target) {
  const region = target.joints.map((j) => REGION_OF_BONE(j.name));
  const head = target.index.get('Head');
  const stray = strayFilter(piece.position);
  const y = (i) => piece.position[i * 3 + 1];
  const [, neckY, neckZ] = target.pos('neck_01');
  const keep = [];
  for (let t = 0; t < piece.index.length; t += 3) {
    const tri = [piece.index[t], piece.index[t + 1], piece.index[t + 2]];
    const doms = tri.map((i) => piece.dominant[i]);
    const count = (pred) => doms.filter(pred).length;
    if (!v.keepHead && count((d) => d === head) >= 2) continue;
    if (!v.keepFeet && count((d) => region[d] === 'feet') >= 2) continue;
    if (v.dropRegions && count((d) => v.dropRegions.includes(region[d])) >= 2) continue;
    if (v.keepRegions && !(count((d) => v.keepRegions.includes(region[d])) >= 2 || (v.maxY && tri.every((i) => y(i) < v.maxY)))) continue;
    if (v.minY && tri.every((i) => y(i) < v.minY)) continue;
    // dropNeckBack: a scarf/gorget that wraps the neck inside the skin pokes out at the nape
    if (v.dropNeckBack && count((d) => region[d] === 'neck' || d === head) >= 2 && tri.every((i) => piece.position[i * 3 + 2] < neckZ && y(i) > neckY - 0.08)) continue;
    if (v.drop && piece.sourceDominant && tri.filter((i) => v.drop.test(piece.sourceDominant[i])).length >= 2) continue;
    if (v.removeSkin?.uvRects) {
      const u = tri.reduce((a, i) => a + piece.uv[i * 2], 0) / 3, w = tri.reduce((a, i) => a + piece.uv[i * 2 + 1], 0) / 3;
      if (v.removeSkin.uvRects.some(([x0, y0, rw, rh]) => u >= x0 && u <= x0 + rw && w >= y0 && w <= y0 + rh)) continue;
    }
    if (!stray(tri)) continue;
    keep.push(...tri);
  }
  piece.index = keep;
  return piece;
}

/** Pieces of one visual for one sex, in our bind space. */
async function buildPieces(id, v, target) {
  const docs = await loadSources(v, target.sex);
  const pieces = [];
  for (const doc of docs) {
    let result;
    if (v.method === 'parts' || v.method === 'retarget') {
      const scale = Object.fromEntries(Object.entries(v.scale ?? {}).map(([k, s]) => [k, Array.isArray(s) ? { xyz: s } : { f: parseFloat(s), perp: String(s).endsWith('p') }]));
      result = retargetSkinned(doc, target, { scale });
    } else if (v.method === 'autoskin') {
      result = await autoskinStatic(doc, target, { armDeg: v.armDeg ?? 0, legDeg: v.legDeg ?? 0, rotYDeg: v.rotYDeg ?? 0 });
    } else throw new Error(`${id}: unknown method ${v.method}`);
    for (const prim of result.primitives) {
      if (v.removeMaterials?.test(prim.getMaterial()?.getName() ?? '')) continue;
      const piece = filterPiece(toPiece(prim, result.dominant.get(prim), result.sourceDominant?.get(prim)), v, target);
      if (piece.index.length) pieces.push(piece);
    }
  }
  // doubleSided: an open shell (armour seen from above, into the collar) shows its inside, not the ground
  const sides = (list) => (v.doubleSided ? list.map(withBackFaces) : list);
  if (!v.liner) return sides(await reduce(pieces, v.maxTris));
  // the shell is never simplified: any error lets the skin poke through it
  const shell = await liner(v, target, pieces);
  // the skin under the shell is hidden at runtime (no z-fighting); the band sits 1 cm inside the shell's
  ((hideBands[v.id] ??= {})[target.sex] ??= []).push({ region: 'calves', minY: round3(shell.band.minY + 0.01), maxY: round3(shell.band.maxY - 0.01) });
  return [...sides(await reduce(pieces, v.maxTris - shell.index.length / 3)), shell];
}

/**
 * A thin one-colour shell over our own legs, skinned like the body (closes open-backed boots, or
 * continues trousers below the knee) without touching the skin texture. v.liner:
 *   color, offset (m, default 0.002), maxY ('top' = the piece's top - below, or metres), minY,
 *   backAbove (above this height only the back half of the calf), knee (true: maxY = knee + kneeLift,
 *   default 0.04; higher tucks the shell under trousers that end at the knee).
 */
async function liner(v, target, pieces) {
  const L = v.liner;
  const { readTargetBody } = await import('./lib/skeleton.mjs');
  const body = await readTargetBody(target.sex);
  const region = target.joints.map((j) => REGION_OF_BONE(j.name));
  const top = L.knee ? target.pos('calf_l')[1] + (L.kneeLift ?? 0.04)
    : (typeof L.maxY === 'number' ? L.maxY : Math.max(...pieces.flatMap((p) => [...p.position].filter((_, i) => i % 3 === 1))) - (L.below ?? 0.03));
  const minY = L.minY ?? -Infinity;
  const backAbove = L.backAbove ?? Infinity;
  const dom = (vtx) => { let bi = 0; for (let k = 1; k < 4; k++) if (body.weights[vtx * 4 + k] > body.weights[vtx * 4 + bi]) bi = k; return body.joints[vtx * 4 + bi]; };
  const y = (i) => body.positions[i * 3 + 1];
  const index = [];
  for (let t = 0; t < body.index.length; t += 3) {
    const tri = [body.index[t], body.index[t + 1], body.index[t + 2]];
    const calfZ = target.pos(body.positions[tri[0] * 3] > 0 ? 'calf_l' : 'calf_r')[2];
    // knee triangles mix thigh and calf vertices: both count, or the knee keeps a strip of skin
    const ok = tri.every((i) => (region[dom(i)] === 'calves' || (L.knee && region[dom(i)] === 'thighs')) && y(i) < top && y(i) > minY
      && (y(i) < backAbove || body.positions[i * 3 + 2] < calfZ + 0.01));
    if (ok) index.push(...tri);
  }
  // push outwards from the calf bone axis (winding-independent)
  const off = L.offset ?? 0.002;
  const position = Float32Array.from(body.positions);
  const nrm = new Float32Array(body.count * 3);
  for (let i = 0; i < body.count; i++) {
    const side = body.positions[i * 3] > 0 ? 'l' : 'r';
    const a = target.pos(`calf_${side}`), b = target.pos(`foot_${side}`);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [0, 1, 2].map((k) => body.positions[i * 3 + k] - a[k]);
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
    const r = [0, 1, 2].map((k) => ap[k] - ab[k] * t);
    const l = Math.hypot(...r) || 1;
    for (let k = 0; k < 3; k++) { position[i * 3 + k] += (r[k] / l) * off; nrm[i * 3 + k] = r[k] / l; }
  }
  const hex = L.color.replace('#', '');
  const color = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  const shell = compact({
    position, normal: nrm, uv: new Float32Array(body.count * 2).fill(0.5),
    joints: Uint16Array.from(body.joints), weights: Float32Array.from(body.weights), index,
    dominant: Int32Array.from({ length: body.count }, (_, i) => dom(i)), sourceDominant: null,
    material: { name: 'liner', image: null, color },
  });
  shell.band = { minY: Number.isFinite(minY) ? minY : -1, maxY: top };
  return shell;
}

/** Simplifies a visual's pieces together under its triangle budget (one temp document). */
async function reduce(pieces, maxTris, maxError) {
  const tris = pieces.reduce((a, p) => a + p.index.length / 3, 0);
  if (!maxTris || tris <= maxTris) return pieces.map(compact);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh();
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prims = pieces.map((p) => {
    const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', p.position)).setAttribute('TEXCOORD_0', acc('VEC2', p.uv))
      .setAttribute('JOINTS_0', acc('VEC4', p.joints)).setAttribute('WEIGHTS_0', acc('VEC4', p.weights))
      .setIndices(acc('SCALAR', new Uint32Array(p.index)));
    if (p.normal) prim.setAttribute('NORMAL', acc('VEC3', p.normal));
    // dominant joint travels as a vertex attribute so it survives welding
    prim.setAttribute('_DOMINANT', acc('SCALAR', Float32Array.from(p.dominant)));
    mesh.addPrimitive(prim);
    return prim;
  });
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  await simplifyTo(doc, maxTris, maxError);
  return mesh.listPrimitives().map((prim) => {
    const p = pieces[prims.indexOf(prim)] ?? pieces[0];
    const piece = toPiece(prim, null, null);
    piece.dominant = Int32Array.from(prim.getAttribute('_DOMINANT').getArray());
    piece.material = p.material;
    return compact(piece);
  });
}

/** Drops unused vertices; fills missing normals (area-weighted). */
function compact(piece) {
  const used = [...new Set(piece.index)].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));
  const pick = (a, size, Type) => { if (!a) return null; const o = new Type(used.length * size); used.forEach((v, i) => o.set(a.subarray(v * size, v * size + size), i * size)); return o; };
  const out = {
    ...piece,
    position: pick(piece.position, 3, Float32Array), normal: pick(piece.normal, 3, Float32Array), uv: pick(piece.uv, 2, Float32Array),
    joints: pick(piece.joints, 4, Uint16Array), weights: pick(piece.weights, 4, Float32Array),
    index: piece.index.map((v) => remap.get(v)),
  };
  if (!out.normal) {
    out.normal = new Float32Array(out.position.length);
    for (let t = 0; t < out.index.length; t += 3) {
      const [a, b, c] = [out.index[t], out.index[t + 1], out.index[t + 2]].map((i) => out.position.subarray(i * 3, i * 3 + 3));
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const i of [out.index[t], out.index[t + 1], out.index[t + 2]]) for (let k = 0; k < 3; k++) out.normal[i * 3 + k] += n[k];
    }
    for (let i = 0; i < out.normal.length; i += 3) { const l = Math.hypot(out.normal[i], out.normal[i + 1], out.normal[i + 2]) || 1; for (let k = 0; k < 3; k++) out.normal[i + k] /= l; }
  }
  return out;
}

// ---------------------------------------------------------------- atlas

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function atlasKey(v, piece) {
  const m = piece.material;
  const size = v.sizes?.[m.name] ?? v.size ?? 256;
  const fx = `${v.tint ?? ''}:${v.hue ?? ''}:${v.colorize ?? ''}:${v.brightness ?? ''}`;
  return m.image ? `img:${sha(m.image).slice(0, 16)}:${size}:${fx}` : `col:${m.color.map((c) => c.toFixed(3)).join(',')}:${m.name === 'liner' ? '' : fx}`;
}

/**
 * The piece plus its back side: every triangle again with the winding reversed and the normals
 * negated, on copies of its vertices. A single-sheet cape is then seen from the front too (the
 * inside, between and around the legs) with the same single-sided material, lit from that side.
 */
function withBackFaces(piece) {
  const n = piece.position.length / 3;
  const twice = (a, map = (x) => x) => { if (!a) return a; const o = new a.constructor(a.length * 2); o.set(a); o.set(a.map(map), a.length); return o; };
  return {
    ...piece,
    position: twice(piece.position), normal: twice(piece.normal, (x) => -x), uv: twice(piece.uv),
    joints: twice(piece.joints), weights: twice(piece.weights),
    dominant: piece.dominant?.length === n ? twice(piece.dominant) : piece.dominant,
    sourceDominant: piece.sourceDominant?.length === n ? [...piece.sourceDominant, ...piece.sourceDominant] : piece.sourceDominant,
    index: [...piece.index, ...piece.index.flatMap((_, t, all) => (t % 3 ? [] : [all[t] + n, all[t + 2] + n, all[t + 1] + n]))],
  };
}

// ---------------------------------------------------------------- rigid pieces

const headSizes = {};
/** Size [w, h, d] of our head (body triangles driven by the Head bone). */
async function headSize(target) {
  if (!headSizes[target.sex]) {
    const { readTargetBody } = await import('./lib/skeleton.mjs');
    const b = await readTargetBody(target.sex);
    const head = target.index.get('Head');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < b.count; v++) {
      let bi = 0; for (let k = 1; k < 4; k++) if (b.weights[v * 4 + k] > b.weights[v * 4 + bi]) bi = k;
      if (b.joints[v * 4 + bi] === head) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.positions[v * 3 + k]); max[k] = Math.max(max[k], b.positions[v * 3 + k]); }
    }
    headSizes[target.sex] = [0, 1, 2].map((k) => max[k] - min[k]);
  }
  return headSizes[target.sex];
}
const worldBounds = (node) => {
  const m = node.getWorldMatrix(), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of node.getMesh().listPrimitives()) {
    const P = p.getAttribute('POSITION');
    for (let i = 0; i < P.getCount(); i++) {
      const [x, y, z] = P.getElement(i, []);
      const w = [0, 1, 2].map((k) => m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
    }
  }
  return { min, max };
};
const matMul = (m, v, w = 1) => [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k] * w);

/**
 * A rigid visual: geometry in a neutral frame (Y up, facing +Z, origin at the anchor, sized for the
 * male body) + per sex the matrix that puts it in the anchor bone's space.
 */
async function buildRigid(id, v) {
  const [doc] = await loadSources(v, 'male');
  const male = targets.male;
  const root = doc.getRoot();
  let nodes, ref, S;
  if (v.fit === 'body') {
    // static full figure: fit its height/centre onto our male body, keep a box (our body space), anchor at our bone
    const meshNodes = root.listNodes().filter((n) => n.getMesh());
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const n of meshNodes) { const nb = worldBounds(n); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], nb.min[k]); b.max[k] = Math.max(b.max[k], nb.max[k]); } }
    const body = await (await import('./lib/skeleton.mjs')).readTargetBody('male');
    let by = [Infinity, -Infinity]; for (let i = 1; i < body.positions.length; i += 3) { by = [Math.min(by[0], body.positions[i]), Math.max(by[1], body.positions[i])]; }
    const s = (by[1] - by[0]) / (b.max[1] - b.min[1]);
    const shift = [-(b.min[0] + b.max[0]) / 2 * s, by[0] - b.min[1] * s, -(b.min[2] + b.max[2]) / 2 * s];
    nodes = meshNodes;
    const anchor = male.pos(v.bone);
    S = (p) => [p[0] * s + shift[0] - anchor[0], p[1] * s + shift[1] - anchor[1], p[2] * s + shift[2] - anchor[2]];
    ref = { keep: (p) => [0, 1, 2].every((k) => p[k] + anchor[k] >= v.keepBox.min[k] && p[k] + anchor[k] <= v.keepBox.max[k]) };
  } else {
    nodes = (v.nodes ?? [v.node]).map((name) => {
      const node = root.listNodes().find((n) => n.getName() === name);
      if (!node) throw new Error(`${id}: node ${name} not found`);
      return node;
    });
    const refPos = v.refPoint ?? matMul(root.listNodes().find((n) => n.getName() === v.refBone).getWorldMatrix(), [0, 0, 0]);
    let scale = v.scale ?? 1;
    if (v.fit === 'head') {
      // per axis: chibi heads are as tall as wide, ours is ~1.3x taller than wide
      const rb = worldBounds(root.listNodes().find((n) => n.getName() === v.refMesh));
      const ours = await headSize(male);
      const mul = Array.isArray(v.scale) ? v.scale : [v.scale ?? 1, v.scale ?? 1, v.scale ?? 1];
      scale = [0, 1, 2].map((k) => (ours[k] / (rb.max[k] - rb.min[k])) * mul[k]);
    }
    const sv = Array.isArray(scale) ? scale : [scale, scale, scale];
    S = (p) => [(p[0] - refPos[0]) * sv[0], (p[1] - refPos[1]) * sv[1], (p[2] - refPos[2]) * sv[2]];
  }
  const [rx, ry, rz] = (v.rotDeg ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const R = (p) => { // X then Y then Z
    let [x, y, z] = p;
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    return [x, y, z];
  };
  const pieces = [];
  for (const n of nodes) {
    const m = n.getWorldMatrix();
    for (const prim of n.getMesh().listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const count = P.getCount();
      const position = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) position.set(R(S(matMul(m, P.getElement(i, [])))), i * 3);
      const piece = toPiece(prim, new Int32Array(count), null);
      piece.position = position;
      piece.normal = null; // recomputed (non-uniform scale)
      piece.joints = new Uint16Array(count * 4);
      piece.weights = new Float32Array(count * 4);
      if (ref?.keep) {
        const keep = [];
        for (let t = 0; t < piece.index.length; t += 3) {
          const tri = piece.index.slice(t, t + 3);
          const c = [0, 1, 2].map((k) => tri.reduce((a, i) => a + position[i * 3 + k], 0) / 3);
          if (ref.keep(c)) keep.push(...tri);
        }
        piece.index = keep;
      }
      if (piece.index.length) pieces.push(piece);
    }
  }
  const reduced = await reduce(pieces, v.maxTris);
  for (const p of reduced) p.normal = null;
  const withNormals = reduced.map(compact).map((p) => (v.doubleSided ? withBackFaces(p) : p));
  // per sex: anchor bone space <- neutral frame
  const transform = {};
  for (const sex of SEXES) {
    const t = targets[sex];
    const ratio = v.fit === 'head' ? (await headSize(t))[0] / (await headSize(male))[0] : (t.pos('Head')[1] / male.pos('Head')[1]);
    const anchor = t.pos(v.bone);
    const off = v.offset ?? [0, 0, 0];
    const world = mat4.create();
    mat4.translate(world, world, [anchor[0] + off[0] * ratio, anchor[1] + off[1] * ratio, anchor[2] + off[2] * ratio]);
    mat4.scale(world, world, [ratio, ratio, ratio]);
    const boneWorld = t.joints[t.index.get(v.bone)].world;
    transform[sex] = [...mat4.multiply(mat4.create(), mat4.invert(mat4.create(), boneWorld), world)].map((x) => Math.round(x * 1e6) / 1e6);
  }
  return { pieces: withNormals, transform };
}

// ---------------------------------------------------------------- weapons

const AXIS = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1] };
/**
 * A hand item in the viewer's convention: grip at the origin, long axis +Y, longest extent = length (m).
 * v.up: source axis that becomes +Y ('auto': the longest axis, pointing at its wider end).
 * v.grip: 'blade' (middle of the handle: half-way from the guard at 0 to the pommel), 'origin',
 * 'shield' (back face, centred), or a fraction along the up axis from the bottom.
 * v.nodes: only these mesh nodes. v.stringMaterial: primitives that become the 'BowString' child.
 */
async function buildWeapon(id, v) {
  const [doc] = await loadSources(v, 'male');
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh() && (!v.nodes || v.nodes.includes(n.getName())));
  const raw = []; // [prim, worldPositions]
  for (const n of nodes) {
    const m = n.getWorldMatrix();
    for (const prim of n.getMesh().listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      raw.push([prim, Array.from({ length: P.getCount() }, (_, i) => matMul(m, P.getElement(i, [])))]);
    }
  }
  const all = raw.flatMap(([, ps]) => ps);
  const ext = (k) => [Math.min(...all.map((p) => p[k])), Math.max(...all.map((p) => p[k]))];
  let axis = AXIS[v.up ?? 'y'];
  if (v.up === 'auto') {
    // principal axis of the vertices (power iteration on the covariance), pointing at the wider end
    const c = [0, 1, 2].map((k) => all.reduce((acc, p) => acc + p[k], 0) / all.length);
    const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => all.reduce((acc, p) => acc + (p[i] - c[i]) * (p[j] - c[j]), 0)));
    let e = [1, 1, 1];
    for (let it = 0; it < 64; it++) { const n = [0, 1, 2].map((i) => cov[i][0] * e[0] + cov[i][1] * e[1] + cov[i][2] * e[2]); const l = Math.hypot(...n); e = n.map((x) => x / l); }
    const along = all.map((p) => (p[0] - c[0]) * e[0] + (p[1] - c[1]) * e[1] + (p[2] - c[2]) * e[2]);
    const lo = Math.min(...along), hi = Math.max(...along), band = (hi - lo) * 0.2;
    const radius = (sel) => { const pts = all.filter((_, i) => sel(along[i])); return pts.length ? Math.max(...pts.map((p, i) => { const d = [0, 1, 2].map((k) => p[k] - c[k]); const t = d[0] * e[0] + d[1] * e[1] + d[2] * e[2]; return Math.hypot(d[0] - t * e[0], d[1] - t * e[1], d[2] - t * e[2]); })) : 0; };
    axis = radius((t) => t > hi - band) >= radius((t) => t < lo + band) ? e : e.map((x) => -x);
  }
  const q = quat.rotationTo(quat.create(), axis, [0, 1, 0]);
  const rot = (p) => [...vec3.transformQuat(vec3.create(), p, q)];
  const rotated = raw.map(([prim, ps]) => [prim, ps.map(rot)]);
  const allR = rotated.flatMap(([, ps]) => ps);
  const min = [0, 1, 2].map((k) => Math.min(...allR.map((p) => p[k]))), max = [0, 1, 2].map((k) => Math.max(...allR.map((p) => p[k])));
  const grip = v.grip ?? 'origin';
  const pivot = grip === 'blade' ? [0, min[1] / 2, 0]
    : grip === 'shield' ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]]
    : typeof grip === 'number' ? [(min[0] + max[0]) / 2, min[1] + (max[1] - min[1]) * grip, (min[2] + max[2]) / 2]
    : [0, 0, 0];
  const scale = v.length / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const pieces = [];
  for (const [prim, ps] of rotated) {
    const piece = toPiece(prim, new Int32Array(ps.length), null);
    piece.position = Float32Array.from(ps.flatMap((p) => [0, 1, 2].map((k) => (p[k] - pivot[k]) * scale)));
    piece.normal = null;
    piece.isString = !!v.stringMaterial && prim.getMaterial()?.getName() === v.stringMaterial;
    const override = v.materialColors?.[piece.material.name];
    if (override) piece.material = { ...piece.material, image: null, color: [1, 3, 5].map((k) => parseInt(override.slice(k, k + 2), 16) / 255) };
    if (piece.index.length) pieces.push(piece);
  }
  // paint: [{ material, color, within }] recolours only that material's triangles within `within` m of the face centre (x, y)
  for (const paint of v.paint ?? []) {
    const cy = (min[1] + max[1]) / 2 - pivot[1], cx = (min[0] + max[0]) / 2 - pivot[0];
    for (const p of [...pieces]) {
      if (p.material.name !== paint.material) continue;
      const inside = [], outside = [];
      for (let t = 0; t < p.index.length; t += 3) {
        const tri = p.index.slice(t, t + 3);
        const c = [0, 1].map((k) => tri.reduce((a, i) => a + p.position[i * 3 + k], 0) / 3);
        (Math.hypot((c[0] - cx * scale), (c[1] - cy * scale)) < paint.within ? inside : outside).push(...tri);
      }
      if (!inside.length) continue;
      p.index = outside;
      pieces.push({ ...p, index: inside, material: { ...p.material, name: `${paint.material}:paint`, image: null, color: [1, 3, 5].map((k) => parseInt(paint.color.slice(k, k + 2), 16) / 255) } });
    }
  }
  if (v.smoothBlade) {
    // one profile over every blade piece
    const blade = pieces.filter((p) => v.smoothBlade.test(p.material.name));
    const all = new Float32Array(blade.reduce((a, p) => a + p.position.length, 0));
    let o = 0; for (const p of blade) { all.set(p.position, o); o += p.position.length; }
    smoothBladeEdge(all, () => true);
    o = 0; for (const p of blade) { p.position = all.slice(o, o + p.position.length); o += p.position.length; }
  }
  const strings = pieces.filter((p) => p.isString).map(compact);
  const body = await reduce(pieces.filter((p) => !p.isString), v.maxTris ?? 1500);
  const identity = [...mat4.create()];
  return { pieces: [...body.map((p) => compact({ ...p, normal: null })), ...strings.map((p) => ({ ...p, isString: true }))], transform: { male: identity, female: identity } };
}

// ---------------------------------------------------------------- main

const targets = Object.fromEntries(await Promise.all(SEXES.map(async (s) => [s, await readTargetSkeleton(s)])));
const built = {}; // id -> sex -> pieces
for (const id of visualIds) {
  const v = VISUALS[id];
  if (v.kind !== 'skinned') continue;
  built[id] = {};
  for (const sex of SEXES) built[id][sex] = await buildPieces(id, { ...v, id }, targets[sex]);
}

const rigid = {}; // id -> { pieces, transform }
for (const id of visualIds) if (VISUALS[id].kind === 'rigid') rigid[id] = VISUALS[id].method === 'weapon' ? await buildWeapon(id, VISUALS[id]) : await buildRigid(id, VISUALS[id]);

const atlasEntries = new Map();
const allPieces = [
  ...Object.keys(built).flatMap((id) => SEXES.flatMap((sex) => built[id][sex].map((piece) => [id, piece]))),
  ...Object.keys(rigid).flatMap((id) => rigid[id].pieces.map((piece) => [id, piece])),
];
for (const [id, piece] of allPieces) {
  const v = VISUALS[id];
  const key = atlasKey(v, piece);
  piece.atlasKey = key;
  if (!atlasEntries.has(key)) {
    const m = piece.material;
    atlasEntries.set(key, { id: key, image: m.image, color: m.color, ...(m.name === 'liner' ? {} : { tint: v.tint, hue: v.hue, colorize: v.colorize, brightness: v.brightness }), size: v.sizes?.[m.name] ?? v.size ?? 256 });
  }
}
const atlas = await packAtlas([...atlasEntries.values()]);
const remapped = (piece) => {
  const r = atlas.rects.get(piece.atlasKey);
  const wrap = (t) => (t >= 0 && t <= 1 ? t : t - Math.floor(t));
  const uv = new Float32Array(piece.uv.length);
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = r.swatch ? r.x + r.w / 2 : r.x + wrap(piece.uv[i]) * r.w;
    uv[i + 1] = r.swatch ? r.y + r.h / 2 : r.y + wrap(piece.uv[i + 1]) * r.h;
  }
  return uv;
};

fs.mkdirSync(OUT, { recursive: true });
const report = { visuals: {}, files: {} };
for (const sex of SEXES) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  doc.createScene();
  const { skin } = writeSkeleton(doc, targets[sex]);
  const material = doc.createMaterial('Gear').setMetallicFactor(0).setRoughnessFactor(0.9);
  for (const id of Object.keys(built)) {
    const pieces = built[id][sex];
    const total = pieces.reduce((a, p) => a + p.position.length / 3, 0);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    const jo = new Uint16Array(total * 4), we = new Float32Array(total * 4), idx = [];
    let base = 0;
    for (const p of pieces) {
      const n = p.position.length / 3;
      pos.set(p.position, base * 3); nor.set(p.normal, base * 3); uv.set(remapped(p), base * 2);
      jo.set(p.joints, base * 4); we.set(p.weights, base * 4);
      for (const i of p.index) idx.push(i + base);
      base += n;
    }
    const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const prim = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nor)).setAttribute('TEXCOORD_0', acc('VEC2', uv))
      .setAttribute('JOINTS_0', acc('VEC4', jo)).setAttribute('WEIGHTS_0', acc('VEC4', we))
      .setIndices(acc('SCALAR', total > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)));
    doc.getRoot().listScenes()[0].addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)).setSkin(skin));
    (report.visuals[id] ??= {})[`${sex}Triangles`] = idx.length / 3;
    if (VISUALS[id].maxTris && idx.length / 3 > VISUALS[id].maxTris) throw new Error(`${id} (${sex}): ${idx.length / 3} triangles > ${VISUALS[id].maxTris}`);
  }
  fs.writeFileSync(path.join(OUT, `gear-${sex}.glb`), await io.writeBinary(doc));
}
{
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial('Gear').setMetallicFactor(0).setRoughnessFactor(0.9);
  const meshOf = (name, pieces) => {
    const total = pieces.reduce((a, p) => a + p.position.length / 3, 0);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), idx = [];
    let base = 0;
    for (const p of pieces) {
      pos.set(p.position, base * 3); nor.set(p.normal, base * 3); uv.set(remapped(p), base * 2);
      for (const i of p.index) idx.push(i + base);
      base += p.position.length / 3;
    }
    const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const prim = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nor)).setAttribute('TEXCOORD_0', acc('VEC2', uv))
      .setIndices(acc('SCALAR', total > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)));
    return { mesh: doc.createMesh(name).addPrimitive(prim), triangles: idx.length / 3 };
  };
  for (const id of Object.keys(rigid)) {
    const main = meshOf(id, rigid[id].pieces.filter((p) => !p.isString));
    const node = doc.createNode(id).setMesh(main.mesh);
    const strings = rigid[id].pieces.filter((p) => p.isString);
    if (strings.length) node.addChild(doc.createNode('BowString').setMesh(meshOf('BowString', strings).mesh));
    scene.addChild(node);
    (report.visuals[id] ??= {}).triangles = main.triangles;
  }
  fs.writeFileSync(path.join(OUT, 'gear-rigid.glb'), await io.writeBinary(doc));
}
fs.writeFileSync(path.join(OUT, 'gear-atlas.webp'), await encodeAtlas(atlas.png));
if (process.env.GEAR_DEBUG) fs.writeFileSync(path.join(OUT, 'atlas-debug.png'), atlas.png);

const files = ['gear-male.glb', 'gear-female.glb', 'gear-rigid.glb', 'gear-atlas.webp'];
const manifestVisuals = {};
for (const id of visualIds) {
  const { slot, kind, covers, hidesHair, hidesBeard, bone, weaponType } = VISUALS[id];
  const transform = rigid[id]?.transform;
  const hide = hideBands[id];
  manifestVisuals[id] = Object.fromEntries(Object.entries({ slot, kind, covers, hide, hidesHair, hidesBeard, bone, transform, weaponType }).filter(([, x]) => x !== undefined));
}
const version = sha(Buffer.concat([...files.map((f) => fs.readFileSync(path.join(OUT, f))), Buffer.from(JSON.stringify(manifestVisuals))])).slice(0, 12);
const items = Object.fromEntries(Object.entries(ITEMS).filter(([, vis]) => visualIds.includes(vis)).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify({ version, atlas: 'gear-atlas.webp', items, visuals: manifestVisuals }, null, 2)}\n`);

let bytes = 0;
for (const f of [...files, 'manifest.json']) { const s = fs.statSync(path.join(OUT, f)).size; report.files[f] = s; bytes += s; }
report.atlas = atlas.size;
report.totalBytes = bytes;
fs.writeFileSync(path.join(OUT, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (bytes > MAX_FOLDER_BYTES) throw new Error(`gear folder is ${bytes} bytes > ${MAX_FOLDER_BYTES}`);
console.log(`gear ${version}: ${Object.keys(built).length} skinned visuals, atlas ${atlas.size}px, ${(bytes / 1024).toFixed(0)} kB`);

// ---------------------------------------------------------------- credits
const FREE = /^(CC0|CC Attribution$|CC-BY|Public Domain)/i;
const credits = [];
const sourceKey = (src) => (src.startsWith('kaykit') ? `kaykit:${src.split(':')[1]}` : src.startsWith('weapons:') ? 'weapons' : src);
for (const src of [...new Set(visualIds.map((id) => sourceKey(VISUALS[id].source)))].sort()) {
  const [kind, uid] = src.split(':');
  const meta = kind === 'sketchfab'
    ? JSON.parse(fs.readFileSync(path.join(SOURCE, 'sketchfab', uid, 'meta.json'), 'utf8'))
    : SOURCES[src];
  const usedBy = visualIds.filter((id) => sourceKey(VISUALS[id].source) === src);
  credits.push({ ...meta, usedBy });
}
const line = (c) => `- **${c.title}** — ${c.author ?? 'unknown'} — ${c.license} — ${c.url}\n  Used (modified: retargeted to our skeleton, recoloured into the atlas, reduced) by: ${c.usedBy.join(', ')}`;
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Gear asset credits\n\nGenerated by tools/character-assets/gear/build-gear.mjs. Every model below was modified.\n\n${credits.map(line).join('\n')}\n`);
if (!process.env.GEAR_OUT) {
  const restricted = credits.filter((c) => !FREE.test(c.license ?? ''));
  const body = restricted.length
    ? restricted.map((c) => `* ${c.title}\n  Author: ${c.author} (${c.authorUrl ?? ''})\n  License: ${c.license}\n  URL: ${c.url}\n  Used by: ${c.usedBy.join(', ')}`).join('\n\n')
    : '(none — every gear source in use is CC0 or CC-BY; CC-BY attribution lives in apps/frontend/public/assets/character/gear/CREDITS.md)';
  fs.writeFileSync(path.resolve(here, '../../../UNLICENSED_ASSETS_README.txt'),
    `UNLICENSED ASSETS — settle before publishing\n===========================================\n\nAssets used for testing whose license does not allow commercial use or is unclear.\nThe game is not published yet; contact each author (or replace the asset) before release.\nGenerated by tools/character-assets/gear/build-gear.mjs from the gear sources.\n\n${body}\n`);
}

if (review) {
  execFileSync('node', [path.resolve(here, '../preview/shoot-gear.mjs'), review], { stdio: 'inherit', env: { ...process.env, GEAR_OUT: OUT } });
}
