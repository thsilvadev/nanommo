#!/usr/bin/env node
/**
 * Offline asset pipeline for the town NPCs.
 *
 *   cd tools/npc-assets && npm install && npm run build
 *
 * Reads the CC0 source packs from ./source (see README.md; not versioned) and
 * writes the files the game ships to apps/frontend/public/assets/npcs/:
 *   - outfit-<sex>-<outfit>.glb: skinned outfits on the same 65-bone rig as our
 *     bodies (bound to the body's skeleton at runtime by bone name);
 *   - props.glb: one scene, one top-level node per prop key (see PROPS).
 * Reproducible: rerunning it over the same packs produces the same output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, 'source');
const OUT = path.resolve(here, '../../apps/frontend/public/assets/npcs');

/** First directory under `base` whose name starts with `prefix` (unzip folder names vary). */
function findDir(base, prefix) {
  const hit = fs.readdirSync(base, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix));
  if (!hit) throw new Error(`Missing "${prefix}*" under ${base}. See tools/npc-assets/README.md.`);
  return path.join(base, hit.name);
}
/** Descend while a directory holds exactly one sub-directory and nothing else useful. */
function unwrap(dir, until) {
  while (!fs.existsSync(path.join(dir, until))) {
    const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (dirs.length !== 1) throw new Error(`Cannot find ${until} under ${dir}`);
    dir = path.join(dir, dirs[0].name);
  }
  return path.join(dir, until);
}

const OUTFITS_DIR = unwrap(findDir(SOURCE, 'modular-character-outfits'), 'Exports/glTF (Godot-Unreal)/Outfits');
const FPM_DIR = unwrap(findDir(SOURCE, 'fantasy-props-megakit'), 'Exports/glTF');
const KAYKIT_DIR = unwrap(findDir(SOURCE, 'rpg-tools-bits'), 'Assets/gltf');

const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE).registerExtensions(ALL_EXTENSIONS);
const KEEP_ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']);
const PLACEHOLDER_PNG = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } }).png().toBuffer();

function stripExtraAttributes(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) if (!KEEP_ATTRIBUTES.has(semantic)) primitive.setAttribute(semantic, null);
    }
  }
}

/** Reads a .gltf; a referenced image that is missing is replaced by a placeholder (every texture is rewritten below). */
async function readGltf(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  const resources = {};
  for (const buffer of json.buffers ?? []) resources[buffer.uri] = new Uint8Array(fs.readFileSync(path.join(dir, decodeURIComponent(buffer.uri))));
  for (const image of json.images ?? []) {
    const source = path.join(dir, decodeURIComponent(image.uri));
    resources[image.uri] = new Uint8Array(fs.existsSync(source) ? fs.readFileSync(source) : PLACEHOLDER_PNG);
  }
  return io.readJSON({ json, resources });
}

const jpeg = (input, size) => sharp(input).resize(size, size).flatten({ background: '#000000' }).jpeg({ quality: 85 }).toBuffer();

/** Base colour only, at `size`; normal/ORM maps dropped (flat-shaded town look). */
async function simplifyMaterials(document, size, rename) {
  for (const material of document.getRoot().listMaterials()) {
    material.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    material.setMetallicFactor(0).setRoughnessFactor(0.9);
    const texture = material.getBaseColorTexture();
    if (texture) texture.setImage(await jpeg(Buffer.from(texture.getImage()), size)).setMimeType('image/jpeg').setURI('');
    rename?.(material);
  }
}

async function write(document, file) {
  // Quantized attributes (KHR_mesh_quantization, read by three's GLTFLoader): about half the bytes.
  await document.transform(prune(), dedup(), quantize());
  const out = path.join(OUT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, document);
  return `${file} ${(fs.statSync(out).size / 1024).toFixed(0)} kB`;
}

// ---- Outfits ------------------------------------------------------------------

const OUTFITS = { 'male-peasant': 'Male_Peasant', 'female-peasant': 'Female_Peasant', 'male-ranger': 'Male_Ranger', 'female-ranger': 'Female_Ranger' };

/**
 * The bare-skin parts (hands, forearms) use the pack's skin material: it is
 * renamed `Skin` and loses its texture so the game tints it with the NPC's skin
 * tone; the cloth keeps a 1024 base colour as `Outfit`.
 */
async function buildOutfit(key, name) {
  const document = await readGltf(path.join(OUTFITS_DIR, `${name}.gltf`));
  stripExtraAttributes(document);
  for (const material of document.getRoot().listMaterials()) {
    if (material.getName().startsWith('MI_Regular')) {
      material.setBaseColorTexture(null).setBaseColorFactor([1, 1, 1, 1]).setName('Skin');
    } else {
      material.setName('Outfit');
    }
  }
  await simplifyMaterials(document, 1024);
  const skins = document.getRoot().listSkins();
  if (skins.length !== 1 || skins[0].listJoints().length !== 65) throw new Error(`${name}: expected one 65-joint skin`);
  return write(document, `outfit-${key}.glb`);
}

// ---- Props --------------------------------------------------------------------

/** Prop key -> source file. Quaternius Fantasy Props MegaKit (FPM) and KayKit RPG Tools Bits (KK). */
const PROPS = {
  anvil: ['FPM', 'Anvil'],
  hammer: ['KK', 'hammer'],
  tongs: ['KK', 'tongs'],
  bucket: ['FPM', 'Bucket_Wooden_1'],
  chest: ['FPM', 'Chest_Wood'],
  table: ['FPM', 'Table_Large'],
  counter: ['FPM', 'Workbench'],
  pot: ['FPM', 'Pot_1'],
  cauldron: ['FPM', 'Cauldron'],
  candles: ['FPM', 'CandleStick_Triple'],
  'book-stand': ['FPM', 'BookStand'],
  stool: ['FPM', 'Stool'],
  bag: ['FPM', 'Bag'],
  crate: ['FPM', 'Crate_Wooden'],
};

async function buildProps() {
  const target = new Document();
  target.createBuffer();
  const scene = target.createScene('props');
  for (const [key, [pack, file]] of Object.entries(PROPS)) {
    const source = await readGltf(path.join(pack === 'FPM' ? FPM_DIR : KAYKIT_DIR, `${file}.gltf`));
    stripExtraAttributes(source);
    await simplifyMaterials(source, pack === 'FPM' ? 512 : 256, (m) => m.setName(`${pack}:${m.getName()}`));
    const map = mergeDocuments(target, source);
    const group = target.createNode(key);
    for (const sourceScene of source.getRoot().listScenes()) {
      const merged = map.get(sourceScene);
      for (const child of merged.listChildren()) group.addChild(child);
      merged.dispose();
    }
    scene.addChild(group);
  }
  // mergeDocuments brings one buffer per source; keep a single one.
  const [buffer, ...extra] = target.getRoot().listBuffers();
  for (const accessor of target.getRoot().listAccessors()) accessor.setBuffer(buffer);
  for (const b of extra) b.dispose();
  target.getRoot().setDefaultScene(scene);
  return write(target, 'props.glb');
}

const lines = [];
for (const [key, name] of Object.entries(OUTFITS)) lines.push(await buildOutfit(key, name));
lines.push(await buildProps());
console.log(lines.join('\n'));
