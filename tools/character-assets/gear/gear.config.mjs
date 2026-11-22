/**
 * Gear visuals: one entry per visual, plus which item shows which visual.
 * Sources are described in tools/character-assets/README.md (not versioned).
 *
 * Methods:
 *   parts    — Quaternius Modular Outfits pieces (already on a 65-bone UE rig), per sex.
 *   retarget — a rigged humanoid (Mixamo, Biped, Rigify…) moved onto our skeleton.
 *   autoskin — a static humanoid mesh skinned from our body (armDeg for A-poses).
 *   rigid    — a node pinned to one of our bones (Task 4+).
 * Filters (all optional): keepHead, keepFeet, keepRegions + maxY (shoes), minY (drop
 * triangles entirely below it), drop (source bone regex), removeMaterials (regex on
 * material name), removeSkin.uvRects ([x, y, w, h] in UV units of the source texture).
 * Atlas: size (px per source image), sizes { materialName: px }, tint.
 * covers: body regions hidden under the piece (only regions the piece fully covers).
 */

const QUATERNIUS_SKIN = /^MI_Regular/;
const BODY = { slot: 'body', kind: 'skinned', maxTris: 6000 };
const SHOES = { slot: 'shoes', kind: 'skinned', maxTris: 2500, covers: ['feet'] };
const qParts = (outfit, parts) => ({
  male: parts.map((p) => `Male_${outfit}_${p.male ?? p}`),
  female: parts.map((p) => `Female_${outfit}_${p.female ?? p}`),
});

export const VISUALS = {
  // ---- Body (user-approved order, 2026-11-22) ----
  'body-ranger': { ...BODY, method: 'parts', source: 'quaternius', files: qParts('Ranger', ['Body', 'Legs', 'Arms']),
    removeMaterials: QUATERNIUS_SKIN, size: 512, covers: ['torso', 'upperarms', 'forearms', 'thighs'] },
  'body-dark-knight': { ...BODY, method: 'retarget', source: 'sketchfab:7f59a7b0e952457c9102cd65fe485f09',
    scale: { calf: '1.18p', thigh: '1.08p' }, size: 256,
    covers: ['torso', 'upperarms', 'forearms', 'hands', 'thighs', 'calves'] },
  'body-handpainted-knight': { ...BODY, method: 'retarget', source: 'sketchfab:42b1d37bce974d48bca12a3f9a7d1136',
    drop: /Handle|Bone\./, scale: { hand: '0.55', clavicle: '0.5', upperarm: '0.75p' }, size: 256, sizes: { 'Material.015': 1024 },
    covers: ['torso', 'upperarms', 'forearms', 'hands', 'thighs', 'calves'] },
  'body-peasant': { ...BODY, method: 'parts', source: 'quaternius', files: qParts('Peasant', ['Body', 'Legs', 'Arms']),
    removeMaterials: QUATERNIUS_SKIN, size: 512, covers: ['torso', 'upperarms', 'thighs'] },
  'body-red-robe': { ...BODY, method: 'retarget', source: 'sketchfab:01d1bacb3e9942cdb8808481ea9cb2f7',
    drop: /Prop/, removeSkin: { uvRects: [[0.04, 0.8, 0.63, 0.12]] }, minY: 0.12, size: 256,
    covers: ['torso', 'upperarms', 'thighs', 'calves'] },
  'body-purple-mage': { ...BODY, method: 'retarget', source: 'sketchfab:10771a1d02a145df95824b483515eeb6',
    drop: /STAFF|HAT/, removeMaterials: /^Material\.009$/, minY: 0.12, size: 256,
    covers: ['torso', 'upperarms', 'forearms', 'thighs', 'calves'] },

  // ---- Shoes ----
  'shoes-ranger': { ...SHOES, method: 'parts', source: 'quaternius', files: qParts('Ranger', [{ male: 'Feet_Boots', female: 'Feet' }]),
    removeMaterials: QUATERNIUS_SKIN, size: 512, keepFeet: true },
  'shoes-peasant': { ...SHOES, method: 'parts', source: 'quaternius', files: qParts('Peasant', ['Feet']),
    removeMaterials: QUATERNIUS_SKIN, size: 512, keepFeet: true },
};

// ---- Head (rigid pieces sit on our Head bone; KayKit heads are chibi: fit 'head' scales by head width) ----
const HAT = { slot: 'head', kind: 'rigid', method: 'rigid', bone: 'Head', refBone: 'head', fit: 'head', maxTris: 2000, size: 256, hidesHair: true };
const KK = 'kaykit:adventurers:', KS = 'kaykit:skeletons:';
// ---- Cape (rigid on spine_03; the KayKit capes share one frame: chest bone at the shoulders' base) ----
const CAPE = { slot: 'cape', kind: 'rigid', method: 'rigid', bone: 'spine_03', refBone: 'chest', maxTris: 2000, size: 256,
  scale: [0.45, 0.9, 0.45], offset: [0, 0, -0.04], rotDeg: [-6, 0, 0] };

Object.assign(VISUALS, {
  'head-ranger-hood': { slot: 'head', kind: 'skinned', method: 'parts', source: 'quaternius', files: qParts('Ranger', ['Head_Hood']),
    removeMaterials: QUATERNIUS_SKIN, keepHead: true, size: 512, maxTris: 2000, covers: [], hidesHair: true },
  'head-knight-helmet': { ...HAT, source: `${KK}Knight.glb`, node: 'Knight_Helmet', refMesh: 'Knight_Head', hidesBeard: true },
  'head-warrior-helmet': { ...HAT, source: `${KS}Skeleton_Warrior.glb`, node: 'Skeleton_Warrior_Helmet', refMesh: 'Skeleton_Warrior_Head', hidesBeard: true },
  'head-rogue-hood': { ...HAT, source: `${KS}Skeleton_Rogue.glb`, node: 'Skeleton_Rogue_Hood', refMesh: 'Skeleton_Rogue_Head' },
  'head-mage-hat': { ...HAT, source: `${KK}Mage.glb`, node: 'Mage_Hat', refMesh: 'Mage_Head' },
  'head-skeleton-mage-hat': { ...HAT, source: `${KS}Skeleton_Mage.glb`, node: 'Skeleton_Mage_Hat', refMesh: 'Skeleton_Mage_Skull' },

  'cape-rogue': { ...CAPE, source: `${KK}Rogue.glb`, node: 'Rogue_Cape' },
  'cape-barbarian': { ...CAPE, source: `${KK}Barbarian.glb`, node: 'Barbarian_Cape' },
  'cape-knight': { ...CAPE, source: `${KK}Knight.glb`, node: 'Knight_Cape' },
  'cape-skeleton-rogue': { ...CAPE, source: `${KS}Skeleton_Rogue.glb`, node: 'Skeleton_Rogue_Cape' },
  'cape-mage': { ...CAPE, source: `${KK}Mage.glb`, node: 'Mage_Cape' },
  // Low Poly King (static, separate cape meshes): anchored ~0.25 m under the cape's top, like the KayKit capes
  'cape-king': { ...CAPE, source: 'sketchfab:8de69ab370db447887c17255c2163b05', nodes: ['Cape_08 - Default_0', 'Cape_02 - Default_0'],
    refBone: undefined, refPoint: [0, 1.75, 0], scale: [0.47, 0.57, 0.47], offset: [0, 0.03, -0.04], size: 256, hue: 250 },
});

export const ITEMS = {
  equip_body_phys_t1: 'body-ranger',
  equip_body_phys_t2: 'body-dark-knight',
  equip_body_phys_t3: 'body-handpainted-knight',
  equip_body_magic_t1: 'body-peasant',
  equip_body_magic_t2: 'body-red-robe',
  equip_body_magic_t3: 'body-purple-mage',
  equip_shoes_traveler_t1: 'shoes-ranger',
  equip_shoes_earth_t2: 'shoes-peasant',
  equip_head_phys_t1: 'head-ranger-hood',
  equip_head_phys_t2: 'head-knight-helmet',
  equip_head_phys_t3: 'head-warrior-helmet',
  equip_head_magic_t1: 'head-rogue-hood',
  equip_head_magic_t2: 'head-mage-hat',
  equip_head_magic_t3: 'head-skeleton-mage-hat',
  equip_cape_phys_t1: 'cape-rogue',
  equip_cape_phys_t2: 'cape-barbarian',
  equip_cape_phys_t3: 'cape-knight',
  equip_cape_magic_t1: 'cape-skeleton-rogue',
  equip_cape_magic_t2: 'cape-mage',
  equip_cape_magic_t3: 'cape-king',
};

/** Non-Sketchfab sources (Sketchfab credits come from source/sketchfab/<uid>/meta.json, written by fetch-sources). */
export const SOURCES = {
  quaternius: { title: 'Modular Character Outfits – Fantasy (Standard)', author: 'Quaternius', license: 'CC0 1.0',
    url: 'https://quaternius.itch.io/modular-character-outfits-fantasy' },
  'kaykit:adventurers': { title: 'KayKit Character Pack: Adventurers 1.0', author: 'Kay Lousberg', license: 'CC0 1.0',
    url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0' },
  'kaykit:skeletons': { title: 'KayKit Character Pack: Skeletons 1.0', author: 'Kay Lousberg', license: 'CC0 1.0',
    url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0' },
};
