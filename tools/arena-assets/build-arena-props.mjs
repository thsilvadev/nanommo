// Battle-arena 3D props from downloaded models: each source GLB is flattened to one
// mesh, its palette texture baked into per-face vertex colours (the arena draws props
// flat-shaded and tinted per instance, no textures), stood on y = 0 and centred on x/z.
// All kinds go into one GLB, one mesh per kind named `prop_<kind>`.
//
// Run: node tools/arena-assets/build-arena-props.mjs
// Sources: tools/character-assets/source/arena-props/*.glb (gitignored; authors and
// licences in sources.jsonl there, credits in tools/arena-assets/CREDITS.md).
// Output: apps/frontend/public/assets/arena/props.glb
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const toolsRequire = createRequire(path.join(ROOT, 'tools/character-assets/package.json'));
const load = (name) => import(pathToFileURL(toolsRequire.resolve(name)).href);
const { NodeIO, Document } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { weld } = await load('@gltf-transform/functions');
const sharp = toolsRequire('sharp');

const SOURCE = path.join(ROOT, 'tools/character-assets/source/arena-props');
const OUT = path.join(ROOT, 'apps/frontend/public/assets/arena/props.glb');

/** kind -> source file (all CC0, Avramania "Low Poly Medieval"). */
export const PROP_MODELS = {
  fern: 'avr-fern.glb',
  shrub: 'avr-bush.glb',
  tuft: 'avr-grass.glb',
  flowers: 'avr-flowers.glb',
  stump: 'avr-stump.glb',
  deadtree: 'avr-deadtree.glb',
  mossrock: 'avr-rock-mossy.glb',
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

async function texels(texture) {
  if (!texture) return null;
  const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
function sample(img, u, v) {
  const x = Math.min(img.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * img.h)));
  const i = (y * img.w + x) * 4;
  return [img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255].map(srgbToLinear);
}
function mul4(m, p) {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

/** Every triangle of a model, world positions and one linear colour per face. */
async function bake(file) {
  const doc = await io.read(path.join(SOURCE, file));
  const positions = [], colors = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
      const material = prim.getMaterial();
      const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const img = await texels(material?.getBaseColorTexture() ?? null);
      const count = idx ? idx.getCount() : pos.getCount();
      const at = (k) => (idx ? idx.getScalar(k) : k);
      for (let t = 0; t + 2 < count; t += 3) {
        const ids = [at(t), at(t + 1), at(t + 2)];
        let rgb = [1, 1, 1];
        if (img && uv) {
          const u = ids.reduce((s, i) => s + uv.getElement(i, [])[0], 0) / 3;
          const v = ids.reduce((s, i) => s + uv.getElement(i, [])[1], 0) / 3;
          rgb = sample(img, u, v);
        }
        rgb = rgb.map((c, k) => c * factor[k]);
        for (const i of ids) { positions.push(...mul4(world, pos.getElement(i, []))); colors.push(...rgb); }
      }
    }
  }
  // Stand on y = 0, centred on x/z (the arena scales props about their base).
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  const shift = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) positions[i + k] += shift[k];
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), size: max.map((m, k) => m - min[k]) };
}

const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('arena-props');
const report = [];
for (const [kind, file] of Object.entries(PROP_MODELS)) {
  const { positions, colors, size } = await bake(file);
  const prim = out.createPrimitive()
    .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('COLOR_0', out.createAccessor().setType('VEC3').setArray(colors).setBuffer(buffer))
    .setMaterial(out.createMaterial(`prop_${kind}`));
  const mesh = out.createMesh(`prop_${kind}`).addPrimitive(prim);
  scene.addChild(out.createNode(`prop_${kind}`).setMesh(mesh));
  report.push(`${kind.padEnd(9)} ${String(positions.length / 9).padStart(5)} tris  ${size.map((s) => s.toFixed(2)).join(' x ')} m  (${file})`);
}
await out.transform(weld());
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, out);
console.log(report.join('\n'));
console.log(`${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB`);
