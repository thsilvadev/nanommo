#!/usr/bin/env node
/**
 * Offline asset pipeline for the 3D character viewer.
 *
 *   cd tools/character-assets && npm install && npm run build
 *
 * Reads the CC0 source packs from ./source (see README.md; not versioned) and
 * writes the files the game ships to apps/frontend/public/assets/character/.
 * Reproducible: rerunning it over the same packs produces the same output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, VertexLayout } from '@gltf-transform/core';
import { dedup, prune, resample, transformMesh } from '@gltf-transform/functions';
import { mat4 } from 'gl-matrix';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, 'source');
const OUT = path.resolve(here, '../../apps/frontend/public/assets/character');

/** First directory under `base` whose name starts with `prefix` (the user's unzip folder names vary). */
function findDir(base, prefix) {
  const hit = fs.readdirSync(base, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix));
  if (!hit) throw new Error(`Missing "${prefix}*" under ${base}. See tools/character-assets/README.md.`);
  return path.join(base, hit.name);
}
const only = (dir) => path.join(dir, fs.readdirSync(dir, { withFileTypes: true }).find((e) => e.isDirectory()).name);

const BASE = only(findDir(SOURCE, 'universal-base-ch'));
const UAL = only(findDir(SOURCE, 'universal-animation-library'));
const WEAPONS = only(findDir(SOURCE, 'medieval-weapons'));

const BODY_DIR = path.join(BASE, 'Base Characters/Godot - UE');
const BODY_TEX = path.join(BASE, 'Base Characters/Textures');
const HAIR_DIR = path.join(BASE, 'Hairstyles/Origin at 0/glTF (Godot)');

// Separate (non-interleaved) vertex buffers: the viewer reads and rewrites positions directly.
const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE);
const KEEP_ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']);

function stripExtraAttributes(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        if (!KEEP_ATTRIBUTES.has(semantic)) primitive.setAttribute(semantic, null);
      }
    }
  }
}

const PLACEHOLDER_PNG = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } }).png().toBuffer();

/**
 * The packs' .gltf files reference a few texture files that are not shipped
 * (e.g. T_Hair_1_Normal_png.png). Every texture is replaced or dropped below,
 * so a missing image is substituted with a placeholder instead of failing.
 */
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

async function jpeg(file, size, { greyscale = false } = {}) {
  let image = sharp(file).resize(size, size).flatten({ background: '#000000' });
  if (greyscale) image = image.greyscale().normalise();
  return image.jpeg({ quality: 86 }).toBuffer();
}

async function write(document, file) {
  await document.transform(prune(), dedup());
  const out = path.join(OUT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, document);
  return `${file} ${(fs.statSync(out).size / 1024).toFixed(0)} kB`;
}

/**
 * Body: skinned body + eyes + eyebrows on the 65-bone humanoid rig.
 * Mesh nodes are renamed Body / Eyes / Brows so the viewer can find them.
 * Only base colour is kept: the body texture is recomposed at runtime (skin
 * tone, mouth, facial hair, tattoo), and brows are tinted with the hair colour.
 */
async function buildBody(sex, { gltf, skinTexture, hairTexture, names }) {
  const document = await readGltf(path.join(BODY_DIR, gltf));
  const root = document.getRoot();
  stripExtraAttributes(document);

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && names[mesh.getName()]) node.setName(names[mesh.getName()]);
  }
  const unnamed = root.listNodes().filter((n) => n.getMesh()).map((n) => n.getName()).filter((n) => !['Body', 'Eyes', 'Brows'].includes(n));
  if (unnamed.length) throw new Error(`${gltf}: unexpected mesh nodes ${unnamed.join(', ')}`);

  for (const material of root.listMaterials()) {
    material.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null);
    material.setMetallicFactor(0);
    const name = material.getName();
    const texture = material.getBaseColorTexture();
    if (name.startsWith('MI_Superhero')) {
      texture.setImage(await jpeg(path.join(BODY_TEX, skinTexture), 1024)).setMimeType('image/jpeg');
      material.setName('Skin').setRoughnessFactor(0.85);
    } else if (name.startsWith('MI_Hair')) {
      texture.setImage(await jpeg(path.join(BODY_TEX, hairTexture), 256, { greyscale: true })).setMimeType('image/jpeg');
      material.setName('Hair').setRoughnessFactor(0.85);
    } else if (name === 'MI_Eyes') {
      texture.setImage(await jpeg(path.join(BODY_TEX, 'T_Eye_Brown.png'), 256)).setMimeType('image/jpeg');
      material.setName('Eyes').setRoughnessFactor(0.35);
    } else {
      throw new Error(`${gltf}: unexpected material ${name}`);
    }
  }
  return write(document, `body-${sex}.glb`);
}

const BODY_SOURCES = {
  male: 'Superhero_Male_FullBody.gltf',
  female: 'Superhero_Female_FullBody.gltf',
};
const headBindCache = {};

/** World matrix of the Head bone in the bind pose of a body. */
async function headBindMatrix(sex) {
  if (!headBindCache[sex]) {
    const document = await readGltf(path.join(BODY_DIR, BODY_SOURCES[sex]));
    const head = document.getRoot().listNodes().find((node) => node.getName() === 'Head');
    if (!head) throw new Error(`${BODY_SOURCES[sex]}: no Head bone`);
    headBindCache[sex] = head.getWorldMatrix();
  }
  return headBindCache[sex];
}

/**
 * Hair / beard: static mesh, baked into the Head bone's local space of the body
 * it was modelled for (`fitsSex`). The viewer parents it to the Head bone of
 * whichever body is shown; both rigs share the head orientation, so a hair
 * modelled for one body sits on the other one too.
 */
async function buildHair(source, target, hairTexture, fitsSex) {
  const document = await readGltf(path.join(HAIR_DIR, source));
  stripExtraAttributes(document);
  const root = document.getRoot();
  const toHead = mat4.invert(mat4.create(), await headBindMatrix(fitsSex));
  const scene = root.listScenes()[0];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    transformMesh(mesh, mat4.multiply(mat4.create(), toHead, node.getWorldMatrix()));
    node.setMatrix(mat4.create());
    node.getParentNode()?.removeChild(node);
    scene.addChild(node);
  }
  for (const material of root.listMaterials()) {
    material.setNormalTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.85).setName('Hair');
    material.getBaseColorTexture()?.setImage(await jpeg(path.join(BASE, 'Hairstyles/Textures', hairTexture), 256, { greyscale: true })).setMimeType('image/jpeg');
    material.setDoubleSided(true);
  }
  return write(document, `hair/${target}.glb`);
}

const CLIPS = {
  Idle_Loop: 'Idle', Walk_Loop: 'Walk', Sword_Attack: 'Attack', Hit_Chest: 'Damage', Death01: 'Dead',
  // Combat guard between actions; hands joined while a cast is charging (enter, then hold).
  Sword_Idle: 'CombatIdle', Spell_Simple_Enter: 'CastStart', Spell_Simple_Idle_Loop: 'CastLoop', Hit_Head: 'Damage2',
  // Town emotes (/dance, /sit: sit down, then hold seated).
  Dance_Loop: 'Dance', Sitting_Enter: 'SitDown', Sitting_Idle_Loop: 'Sit',
  // Battle arena: kneel to gather, sprint to dash / flee. (Stun holds a frame of Damage2.)
  Fixing_Kneeling: 'Gather', Sprint_Loop: 'Sprint',
};

/**
 * Animations: the clips in CLIPS, shared by both bodies (identical bone names).
 * Rotation tracks only, plus the pelvis translation: bone lengths must come
 * from each body, not from the library's mannequin. The mannequin mesh is dropped.
 */
async function buildAnimations() {
  const document = await io.read(path.join(UAL, 'Unreal-Godot/UAL1_Standard.glb'));
  const root = document.getRoot();
  for (const animation of root.listAnimations()) {
    const name = CLIPS[animation.getName()];
    if (!name) {
      // Dispose children explicitly: orphaned samplers would keep their keyframe data alive.
      for (const channel of animation.listChannels()) channel.dispose();
      for (const sampler of animation.listSamplers()) sampler.dispose();
      animation.dispose();
      continue;
    }
    animation.setName(name);
    for (const channel of animation.listChannels()) {
      const targetPath = channel.getTargetPath();
      const bone = channel.getTargetNode()?.getName();
      const keep = targetPath === 'rotation' || (targetPath === 'translation' && bone === 'pelvis');
      if (!keep) { channel.getSampler()?.dispose(); channel.dispose(); }
    }
  }
  const found = root.listAnimations().map((a) => a.getName()).sort();
  if (found.join() !== Object.values(CLIPS).sort().join()) throw new Error(`animation library is missing clips; found ${found.join(', ')}`);
  for (const node of root.listNodes()) node.setMesh(null).setSkin(null);
  for (const skin of root.listSkins()) skin.dispose();
  await document.transform(resample());
  return write(document, 'animations.glb');
}

/** length = target size in metres along the model's longest axis; grip = point (model units) moved to the origin. */
const WEAPON_SOURCES = {
  dagger: { obj: 'Dagger.obj', length: 0.36, grip: [0, -0.29, 0] },
  sword: { obj: 'Sword.obj', length: 0.95, grip: [0, -0.41, 0] },
  greatsword: { obj: 'Sword_Big.obj', length: 1.45, grip: [0, -0.17, 0] },
  bow: { obj: 'Bow_Wooden.obj', length: 1.25, grip: [0, 0, 0] },
  shield: { obj: 'Shield_Round.obj', length: 0.62, grip: [0, 0, -0.37] },
};

/** Kd colours from a Wavefront .mtl file. */
function readMtl(file) {
  const colors = {};
  let current = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [keyword, ...rest] = line.trim().split(/\s+/);
    if (keyword === 'newmtl') current = rest[0];
    else if (keyword === 'Kd' && current) colors[current] = rest.slice(0, 3).map(Number);
  }
  return colors;
}

/**
 * Wavefront OBJ -> GLB, flat shaded (one normal per face), one primitive per
 * material. The grip point is moved to the origin and the model scaled to
 * metres, so the viewer only needs a per-type hand pose.
 */
async function buildWeapon(type, { obj, length, grip }) {
  const file = path.join(WEAPONS, 'OBJ', obj);
  const colors = readMtl(file.replace(/\.obj$/, '.mtl'));
  const vertices = [];
  const facesByMaterial = new Map();
  let material = 'default';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [keyword, ...rest] = line.trim().split(/\s+/);
    if (keyword === 'v') vertices.push(rest.slice(0, 3).map(Number));
    else if (keyword === 'usemtl') material = rest[0];
    else if (keyword === 'f') {
      const indices = rest.map((token) => { const i = parseInt(token.split('/')[0], 10); return i < 0 ? vertices.length + i : i - 1; });
      if (!facesByMaterial.has(material)) facesByMaterial.set(material, []);
      facesByMaterial.get(material).push(indices);
    }
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], v[a]); max[a] = Math.max(max[a], v[a]); }
  const scale = length / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const placed = vertices.map((v) => [(v[0] - grip[0]) * scale, (v[1] - grip[1]) * scale, (v[2] - grip[2]) * scale]);

  const document = new Document();
  const buffer = document.createBuffer();
  const mesh = document.createMesh(type);
  for (const [name, faces] of facesByMaterial) {
    const positions = [];
    const normals = [];
    for (const face of faces) {
      // Fan triangulation; each triangle carries the face normal (faceted low-poly look).
      for (let i = 1; i + 1 < face.length; i++) {
        const [a, b, c] = [placed[face[0]], placed[face[i]], placed[face[i + 1]]];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const len = Math.hypot(...n) || 1;
        for (const p of [a, b, c]) { positions.push(...p); normals.push(n[0] / len, n[1] / len, n[2] / len); }
      }
    }
    const metal = /steel/i.test(name);
    const [r, g, b] = colors[name] ?? [0.5, 0.5, 0.5];
    mesh.addPrimitive(document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
      .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
      .setMaterial(document.createMaterial(name).setBaseColorFactor([r, g, b, 1]).setMetallicFactor(metal ? 0.6 : 0).setRoughnessFactor(metal ? 0.45 : 0.85)));
  }
  document.createScene().addChild(document.createNode(type).setMesh(mesh));
  return write(document, `weapons/${type}.glb`);
}

const report = [];
report.push(await buildBody('male', {
  gltf: BODY_SOURCES.male, skinTexture: 'T_Superhero_Male_Ligh.png', hairTexture: 'T_Hair_1_BaseColor.png',
  names: { 'Sphere.005_Retopology.004': 'Body', 'Face.001': 'Eyes', Face: 'Brows' },
}));
report.push(await buildBody('female', {
  gltf: BODY_SOURCES.female, skinTexture: 'T_Superhero_Female_Light_BaseColor.png', hairTexture: 'T_Hair_2_BaseColor.png',
  names: { Superhero_Female: 'Body', Eyes: 'Eyes', Eyebrows: 'Brows' },
}));
report.push(await buildAnimations());
// Which body each piece was modelled for was measured against the head-top
// height of each body (male 1.81 m, female 1.77 m).
for (const [source, target, texture, fitsSex] of [
  ['Hair_Buzzed.gltf', 'buzzed', 'T_Hair_1_BaseColor.png', 'male'],
  ['Hair_BuzzedFemale.gltf', 'buzzed_female', 'T_Hair_2_BaseColor.png', 'female'],
  ['Hair_SimpleParted.gltf', 'parted', 'T_Hair_1_BaseColor.png', 'male'],
  ['Hair_Long.gltf', 'long', 'T_Hair_2_BaseColor.png', 'female'],
  ['Hair_Buns.gltf', 'buns', 'T_Hair_2_BaseColor.png', 'female'],
  ['Hair_Beard.gltf', 'beard', 'T_Hair_1_BaseColor.png', 'male'],
]) report.push(await buildHair(source, target, texture, fitsSex));
for (const [type, config] of Object.entries(WEAPON_SOURCES)) report.push(await buildWeapon(type, config));

console.log(report.join('\n'));
