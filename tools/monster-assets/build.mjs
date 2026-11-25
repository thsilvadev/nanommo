/**
 * node build.mjs [id ...]  — builds apps/frontend/public/assets/monsters/<id>.glb + manifest.json.
 * Sources: tools/character-assets/source/ (run fetch-sources.mjs first).
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { unpartition, mergeDocuments, prune, dedup, textureCompress, metalRough, resample, weld, simplify, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { MONSTERS, NPC_FIGURES } from './monsters.config.mjs';
import { buildNative } from './lib/native.mjs';
import { buildCharacter } from './lib/character.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '../character-assets/source');
export const OUT = path.join(HERE, '../../apps/frontend/public/assets/monsters');
const picks = JSON.parse(fs.readFileSync(path.join(HERE, 'picks.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, name); if (hit) return hit; } else if (e.name === name) return p;
  }
  return null;
}
export function sourceFile(id, cfg) {
  if (cfg.uid) return path.join(SOURCE, 'sketchfab', cfg.uid, 'model.glb');
  if (cfg.source?.startsWith('kaykit:')) return findFile(path.join(SOURCE, 'kaykit-Skeletons'), cfg.source.slice(7));
  const f = path.join(SOURCE, 'sketchfab', picks[id].uid, 'model.glb');
  if (!fs.existsSync(f)) throw new Error(`${id}: missing ${f} — run node fetch-sources.mjs`);
  return f;
}

/** Hue rotation / saturation / brightness on every base colour texture: hue = { h: degrees, s, b }. */
async function recolor(doc, { h = 0, s = 1, b = 1 }) {
  const seen = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    const t = m.getBaseColorTexture(); if (!t || seen.has(t)) continue; seen.add(t);
    t.setImage(new Uint8Array(await sharp(Buffer.from(t.getImage())).modulate({ hue: h, saturation: s, brightness: b }).png().toBuffer())).setMimeType('image/png');
  }
}

/** Per-pixel HSL rules: { h: [lo, hi] degrees, s: [lo, hi], l: [lo, hi], to: { h?, sMul?, lMul? } }. */
const RULES = {
  goldToGreen: [
    { h: [32, 70], s: [0.3, 1], l: [0.15, 0.95], to: { h: 115 } },          // gold trims -> green
    { h: [0, 32], s: [0.12, 0.65], l: [0.35, 0.9], to: { lMul: 0.55, sMul: 1.1 } }, // light skin -> brown
  ],
};
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
/** Blotches of `color` over every base colour texture (smooth value noise in texture space): { color: [r,g,b] 0..1, amount, cells }. */
async function mottle(doc, { color, amount = 0.45, cells = 14, threshold = 0.55 }) {
  const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  const smooth = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const seen = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    const t = m.getBaseColorTexture(); if (!t || seen.has(t)) continue; seen.add(t);
    const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const n = 0.65 * smooth((x / info.width) * cells, (y / info.height) * cells) + 0.35 * smooth((x / info.width) * cells * 3, (y / info.height) * cells * 3);
      const k = Math.max(0, Math.min(1, (n - threshold) / 0.12)) * amount; if (!k) continue;
      const i = (y * info.width + x) * 4; const lum = (data[i] + data[i + 1] + data[i + 2]) / 765;
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - k) + color[c] * 255 * (0.5 + lum) * k;
    }
    t.setImage(new Uint8Array(await sharp(data, { raw: info }).png().toBuffer())).setMimeType('image/png');
  }
}
/** Repaints every base colour texture in one colour, keeping each pixel's relative lightness (dark textures become e.g. stone grey). */
async function stone(doc, color) {
  const seen = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    const t = m.getBaseColorTexture(); if (!t || seen.has(t)) continue; seen.add(t);
    const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let lo = 1, hi = 0; for (let i = 0; i < data.length; i += 4) { const l = (data[i] + data[i + 1] + data[i + 2]) / 765; lo = Math.min(lo, l); hi = Math.max(hi, l); }
    for (let i = 0; i < data.length; i += 4) {
      const l = ((data[i] + data[i + 1] + data[i + 2]) / 765 - lo) / Math.max(1e-3, hi - lo);
      for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, color[c] * 255 * (0.45 + 1.1 * l));
    }
    t.setImage(new Uint8Array(await sharp(data, { raw: info }).png().toBuffer())).setMimeType('image/png');
  }
}
async function recolorRules(doc, rules) {
  const seen = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    const t = m.getBaseColorTexture(); if (!t || seen.has(t)) continue; seen.add(t);
    const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      let [h, s, l] = rgb2hsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
      const r = rules.find((x) => h >= x.h[0] && h <= x.h[1] && s >= x.s[0] && s <= x.s[1] && l >= x.l[0] && l <= x.l[1]); if (!r) continue;
      if (r.to.h !== undefined) h = r.to.h; s = Math.min(1, s * (r.to.sMul ?? 1)); l = Math.min(1, l * (r.to.lMul ?? 1));
      const c = hsl2rgb(h, s, l); data[i] = c[0] * 255; data[i + 1] = c[1] * 255; data[i + 2] = c[2] * 255;
    }
    t.setImage(new Uint8Array(await sharp(data, { raw: info }).png().toBuffer())).setMimeType('image/png');
  }
}

fs.mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const only = process.argv.slice(2);
for (const [id, cfg] of Object.entries(MONSTERS)) {
  if (only.length && !only.includes(id)) continue;
  if (cfg.kind === 'char') { manifest[id] = { rig: 'char', character: cfg.character, fx: cfg.fx ?? [] }; continue; }
  const doc = await io.read(sourceFile(id, cfg));
  await doc.transform(metalRough());
  if (cfg.hue) await recolor(doc, cfg.hue);
  if (cfg.recolor) await recolorRules(doc, RULES[cfg.recolor]);
  if (cfg.stone) await stone(doc, cfg.stone);
  if (cfg.mottle) await mottle(doc, cfg.mottle);
  const info = cfg.kind === 'native' ? buildNative(doc, id, cfg) : await buildCharacter(doc, id, cfg);
  for (const pr of cfg.props ?? []) {
    const src = await io.read(findFile(path.join(SOURCE, 'kaykit-Skeletons'), pr.file));
    const map = mergeDocuments(doc, src);
    const bone = doc.getRoot().listNodes().find((n) => n.getName() === pr.bone);
    if (!bone) throw new Error(`${id}: no bone ${pr.bone}`);
    for (const sc of src.getRoot().listScenes()) { const copy = map.get(sc); for (const n of copy.listChildren()) { copy.removeChild(n); bone.addChild(n); } copy.dispose(); }
  }
  if (cfg.maxTris) {
    let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    if (tris > cfg.maxTris) { await MeshoptSimplifier.ready; await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: cfg.maxTris / tris, error: 0.01 })); }
  }
  await doc.transform(unpartition(), resample({ tolerance: 1e-3 }), prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }));
  for (const a of doc.getRoot().listAccessors()) if (a.listParents().every((x) => x.propertyType === 'Root' || (x.propertyType === 'AnimationSampler' && !x.listParents().some((y) => y.propertyType === 'Animation')))) a.dispose();
  const file = `${id}.glb`;
  fs.writeFileSync(path.join(OUT, file), await io.writeBinary(doc));
  // rev: bumped when a GLB is rebuilt in place, so browsers and the CDN (cached for a day) fetch the new one.
  manifest[id] = { file: cfg.rev ? `${file}?v=${cfg.rev}` : file, rig: cfg.kind, height: info.height, clips: info.clips, generated: info.generated, ...(cfg.weapon ? { weapon: cfg.weapon } : {}), fx: cfg.fx ?? [] };
  console.log(id, cfg.kind, `${(fs.statSync(path.join(OUT, file)).size / 1e6).toFixed(2)}MB`, `h=${info.height}`, info.clips.join(','), info.generated?.length ? `gen:${info.generated}` : '');
}
fs.writeFileSync(manifestFile, JSON.stringify(Object.fromEntries(Object.keys(MONSTERS).filter((k) => manifest[k]).map((k) => [k, manifest[k]])), null, 2) + '\n');

for (const [id, cfg] of Object.entries(NPC_FIGURES)) {
  if (only.length && !only.includes(id)) continue;
  const doc = await io.read(sourceFile(id, cfg));
  await doc.transform(metalRough());
  const info = buildNative(doc, id, cfg);
  await doc.transform(unpartition(), resample({ tolerance: 1e-3 }), prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }));
  for (const a of doc.getRoot().listAccessors()) if (a.listParents().every((x) => x.propertyType === 'Root' || (x.propertyType === 'AnimationSampler' && !x.listParents().some((y) => y.propertyType === 'Animation')))) a.dispose();
  const file = path.join(OUT, '../npcs', `figure-${id}.glb`);
  fs.writeFileSync(file, await io.writeBinary(doc));
  console.log('npc', id, `${(fs.statSync(file).size / 1e6).toFixed(2)}MB`, `h=${info.height}`, info.clips.join(','));
}
