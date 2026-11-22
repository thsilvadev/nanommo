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
import { ITEMS, VISUALS, SOURCES } from './gear.config.mjs';
import { CHARACTER_ASSETS, readTargetSkeleton, writeSkeleton } from './lib/skeleton.mjs';
import { retargetSkinned } from './lib/retarget.mjs';
import { autoskinStatic } from './lib/autoskin.mjs';
import { REGION_OF_BONE, strayFilter } from './lib/regions.mjs';
import { packAtlas } from './lib/atlas.mjs';
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
  throw new Error(`unknown source ${v.source}`);
}

// ---------------------------------------------------------------- pieces

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
    joints: arr(J, 4, Uint16Array),
    weights: arr(W, 4, Float32Array),
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
  const keep = [];
  for (let t = 0; t < piece.index.length; t += 3) {
    const tri = [piece.index[t], piece.index[t + 1], piece.index[t + 2]];
    const doms = tri.map((i) => piece.dominant[i]);
    const count = (pred) => doms.filter(pred).length;
    if (!v.keepHead && count((d) => d === head) >= 2) continue;
    if (!v.keepFeet && count((d) => region[d] === 'feet') >= 2) continue;
    if (v.keepRegions && !(count((d) => v.keepRegions.includes(region[d])) >= 2 || (v.maxY && tri.every((i) => y(i) < v.maxY)))) continue;
    if (v.minY && tri.every((i) => y(i) < v.minY)) continue;
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
      const scale = Object.fromEntries(Object.entries(v.scale ?? {}).map(([k, s]) => [k, { f: parseFloat(s), perp: String(s).endsWith('p') }]));
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
  return reduce(pieces, v.maxTris);
}

/** Simplifies a visual's pieces together under its triangle budget (one temp document). */
async function reduce(pieces, maxTris) {
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
  await simplifyTo(doc, maxTris);
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
  return m.image ? `img:${sha(m.image).slice(0, 16)}:${size}:${v.tint ?? ''}` : `col:${m.color.map((c) => c.toFixed(3)).join(',')}:${v.tint ?? ''}`;
}

// ---------------------------------------------------------------- main

const targets = Object.fromEntries(await Promise.all(SEXES.map(async (s) => [s, await readTargetSkeleton(s)])));
const built = {}; // id -> sex -> pieces
for (const id of visualIds) {
  const v = VISUALS[id];
  if (v.kind !== 'skinned') continue;
  built[id] = {};
  for (const sex of SEXES) built[id][sex] = await buildPieces(id, v, targets[sex]);
}

const atlasEntries = new Map();
for (const id of Object.keys(built)) for (const sex of SEXES) for (const piece of built[id][sex]) {
  const v = VISUALS[id];
  const key = atlasKey(v, piece);
  piece.atlasKey = key;
  if (!atlasEntries.has(key)) {
    const m = piece.material;
    atlasEntries.set(key, { id: key, image: m.image, color: m.color, tint: v.tint, size: v.sizes?.[m.name] ?? v.size ?? 256 });
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
  doc.createBuffer();
  doc.createScene();
  fs.writeFileSync(path.join(OUT, 'gear-rigid.glb'), await io.writeBinary(doc));
}
fs.writeFileSync(path.join(OUT, 'gear-atlas.webp'), await sharp(atlas.png).webp({ quality: 90, effort: 6 }).toBuffer());

const files = ['gear-male.glb', 'gear-female.glb', 'gear-rigid.glb', 'gear-atlas.webp'];
const version = sha(Buffer.concat(files.map((f) => fs.readFileSync(path.join(OUT, f))))).slice(0, 12);
const manifestVisuals = {};
for (const id of visualIds) {
  const { slot, kind, covers, hidesHair, hidesBeard, bone, transform, weaponType } = VISUALS[id];
  manifestVisuals[id] = Object.fromEntries(Object.entries({ slot, kind, covers, hidesHair, hidesBeard, bone, transform, weaponType }).filter(([, x]) => x !== undefined));
}
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
for (const src of [...new Set(visualIds.map((id) => VISUALS[id].source))].sort()) {
  const [kind, uid] = src.split(':');
  const meta = kind === 'sketchfab'
    ? JSON.parse(fs.readFileSync(path.join(SOURCE, 'sketchfab', uid, 'meta.json'), 'utf8'))
    : SOURCES[src];
  const usedBy = visualIds.filter((id) => VISUALS[id].source === src);
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
