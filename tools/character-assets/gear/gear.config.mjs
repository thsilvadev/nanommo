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
  // T2/T3 physical: shin guards removed (user, 2026-11-22) — legs end at the knee, boots take the shin
  'body-dark-knight': { ...BODY, method: 'retarget', source: 'sketchfab:7f59a7b0e952457c9102cd65fe485f09',
    scale: { thigh: '1.08p' }, dropRegions: ['calves'], size: 256, maxTris: 6600,
    liner: { color: '#2b2b2d', knee: true, minY: 0.22, offset: 0.002 },
    covers: ['torso', 'upperarms', 'forearms', 'hands', 'thighs'] },
  'body-handpainted-knight': { ...BODY, method: 'retarget', source: 'sketchfab:42b1d37bce974d48bca12a3f9a7d1136',
    // silhouette (user, 2026-11-23): V torso (chest wider), flatter belly, fuller thighs
    drop: /Handle|Bone\./, scale: { hand: '0.55', clavicle: '0.5', upperarm: '0.75p', spine_03: [1.25, 1, 1], spine_01: [0.86, 1, 0.82], thigh: '1.25p' },
    // metal thigh plates: 15% smaller, on the front of the thighs, close to them (user, 2026-11-23)
    tassets: { yRange: [0.55, 1.05], maxVerts: 400, scale: 0.85, frontDeg: 30, gap: 0.015 }, dropRegions: ['calves'], size: 256, sizes: { 'Material.015': 1024 }, maxTris: 6600,
    // a bit fuller under the knee (user, 2026-11-23), still body-hugging (< 4 mm: build.test.mjs)
    liner: { color: '#3a2a22', knee: true, minY: 0.22, offset: 0.0035 },
    // open at the collar: from above (town camera) the inside shows instead of the ground (user, 2026-11-23)
    doubleSided: true, dropNeckBack: true,
    covers: ['torso', 'upperarms', 'forearms', 'hands', 'thighs'] },
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
    removeMaterials: QUATERNIUS_SKIN, size: 512, keepFeet: true, liner: { color: '#5e3b22', offset: 0.002 }, maxTris: 3400 },
  'shoes-peasant': { ...SHOES, method: 'parts', source: 'quaternius', files: qParts('Peasant', ['Feet']),
    removeMaterials: QUATERNIUS_SKIN, size: 512, keepFeet: true, liner: { color: '#4f4526', offset: 0.002 }, maxTris: 3400 },
};
// Elemental boots: the earth (Peasant) boots recoloured per element (user, 2026-11-22).
// The liner (inside of the shaft) takes a darker shade of the boot colour.
for (const [el, colorize, brightness, liner] of [
  ['fire', '#d8442a', 1, '#7a2416'], ['wind', '#ffd83a', 1.45, '#8a7420'], ['water', '#3f7fd6', 1, '#1f3f72'],
  ['holy', '#e2dcb8', 2.5, '#b3ad8e'], ['shadow', '#3a3740', 0.55, '#1c1b20'],
]) {
  VISUALS[`shoes-${el}`] = { ...VISUALS['shoes-peasant'], colorize, size: 256, brightness, liner: { ...VISUALS['shoes-peasant'].liner, color: liner } };
}

// ---- Head (rigid pieces sit on our Head bone; KayKit heads are chibi: fit 'head' scales by head width) ----
const HAT = { slot: 'head', kind: 'rigid', method: 'rigid', bone: 'Head', refBone: 'head', fit: 'head', maxTris: 2000, size: 256, hidesHair: true };
const KK = 'kaykit:adventurers:', KS = 'kaykit:skeletons:';
// ---- Cape (rigid on spine_03; the KayKit capes share one frame: chest bone at the shoulders' base) ----
const CAPE = { slot: 'cape', kind: 'rigid', method: 'rigid', bone: 'spine_03', refBone: 'chest', maxTris: 2000, size: 256,
  scale: [0.62, 1.3, 0.5], offset: [0, -0.07, -0.075], rotDeg: [-8, 0, 0], doubleSided: true }; // hangs from the shoulders, not the nape (user, 2026-11-23)

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
    refBone: undefined, refPoint: [0, 1.75, 0], scale: [0.55, 0.75, 0.5], offset: [0, -0.04, -0.085], size: 256, hue: 250,
    doubleSided: false /* has its own lining */ },
});

// ---- Weapons (grip at the origin, long axis +Y; the rig keeps the per-type hand pose) ----
const W = (slot, weaponType, source, length, extra = {}) => ({ slot, kind: 'rigid', method: 'weapon', bone: 'hand_r', weaponType, source, length, size: 256, maxTris: 1500, ...extra });
const BLADE = { grip: 'blade' };
const BOW = { grip: 'origin', stringMaterial: 'White' };
const SHIELD = { grip: 'shield' };
const KKA = 'kaykit-asset:adventurers:', KSA = 'kaykit-asset:skeletons:';
Object.assign(VISUALS, {
  'sword-medieval': W('mainHand', 'sword', 'weapons:Sword', 0.95, BLADE),
  'sword-claymore': W('mainHand', 'sword', 'weapons:Claymore', 1.0, BLADE),
  'sword-golden': W('mainHand', 'sword', 'weapons:Sword_Golden', 1.05, BLADE),
  'greatsword-big': W('mainHand', 'greatsword', 'weapons:Sword_Big', 1.45, BLADE),
  'greatsword-katana': W('mainHand', 'greatsword', 'sketchfab:09ef2c4a3a62405886c674888bbf244f', 1.45, { up: 'z', grip: 0.14, size: 512 }),
  'greatsword-kaykit': W('mainHand', 'greatsword', `${KKA}sword_2handed_color.gltf`, 1.55),
  // knife: the T1 dagger's old model, 20% smaller, darker blade
  'knife-medieval': W('mainHand', 'dagger', 'weapons:Dagger', 0.224, { ...BLADE, materialColors: { Steel: '#55585e', LightSteel: '#686b71', DarkSteel: '#3c3e43' } }),
  'dagger-serrated': W('mainHand', 'dagger', 'weapons:Sword_2', 0.38, BLADE),
  'dagger-golden': W('mainHand', 'dagger', 'weapons:Dagger_2', 0.4, { ...BLADE, smoothBlade: /Steel/ }),
  'dagger-kaykit': W('mainHand', 'dagger', `${KKA}dagger.gltf`, 0.38),
  'bow-wooden': W('mainHand', 'bow', 'weapons:Bow_Wooden', 1.25, BOW),
  'bow-golden': W('mainHand', 'bow', 'weapons:Bow_Golden', 1.25, BOW),
  'bow-evil': W('mainHand', 'bow', 'weapons:Bow_Evil', 1.3, BOW),
  'staff-kaykit': W('mainHand', 'staff', `${KKA}staff.gltf`, 1.6, { grip: 0.3 }),
  'staff-skeleton': W('mainHand', 'staff', `${KSA}Skeleton_Staff.gltf`, 1.65, { grip: 0.3 }),
  'staff-ancient-gold': W('mainHand', 'staff', 'sketchfab:7c90780035d845e3896914b12e88e9af', 1.7, { up: 'auto', grip: 0.3, nodes: ['ARTIFACT_low_ARTIFACT_0'] }),
  'rod-kaykit': W('mainHand', 'rod', `${KKA}wand.gltf`, 0.55),
  'rod-crystal': W('mainHand', 'rod', 'sketchfab:8605d39c12e14e7c969ab828a351e677', 0.58, { up: 'y', grip: 0.3 }),
  'rod-orb': W('mainHand', 'rod', 'sketchfab:e2c5a4676ef9408a8cb2ed9aa7454ffa', 0.62, { up: 'auto', grip: 0.3 }),
  'shield-round': W('offHand', 'shield', 'weapons:Shield_Round', 0.62, SHIELD),
  'shield-heater': W('offHand', 'shield', 'weapons:Shield_Heater', 0.68, { ...SHIELD, paint: [{ material: 'Steel', color: '#d2372c', within: 0.065 }] }),
  'shield-celtic-golden': W('offHand', 'shield', 'weapons:Shield_Celtic_Golden', 0.78, SHIELD),
  // runes: orbs (user, 2026-11-22) — blue, red, purple
  'rune-orb-blue': W('offHand', 'rune', 'sketchfab:fc381c9a41694f5eac97e6df68d41cf5', 0.16, { nodes: ['Glass_Ball_lambert1_0'], grip: 0, colorize: '#3f86ff', brightness: 1.5 }),
  'rune-orb-red': W('offHand', 'rune', 'sketchfab:fc381c9a41694f5eac97e6df68d41cf5', 0.17, { nodes: ['Glass_Ball_lambert1_0'], grip: 0, colorize: '#ff4a3a', brightness: 1.4 }),
  'rune-orb': W('offHand', 'rune', 'sketchfab:fc381c9a41694f5eac97e6df68d41cf5', 0.18, { nodes: ['Glass_Ball_lambert1_0'], grip: 0, colorize: '#9b6bff', brightness: 1.5 }),
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
  equip_shoes_water_t2: 'shoes-water',
  equip_shoes_fire_t3: 'shoes-fire',
  equip_shoes_shadow_t3: 'shoes-shadow',
  equip_shoes_wind_t4: 'shoes-wind',
  equip_shoes_holy_t4: 'shoes-holy',
  equip_head_phys_t1: 'head-rogue-hood',
  equip_head_phys_t2: 'head-knight-helmet',
  equip_head_phys_t3: 'head-warrior-helmet',
  equip_head_magic_t1: 'head-ranger-hood',
  equip_head_magic_t2: 'head-mage-hat',
  equip_head_magic_t3: 'head-skeleton-mage-hat',
  equip_cape_phys_t1: 'cape-rogue',
  equip_cape_phys_t2: 'cape-barbarian',
  equip_cape_phys_t3: 'cape-knight',
  equip_cape_magic_t1: 'cape-skeleton-rogue',
  equip_cape_magic_t2: 'cape-mage',
  equip_cape_magic_t3: 'cape-king',
  equip_sword_t1: 'sword-medieval', equip_sword_t2: 'sword-claymore', equip_sword_t3: 'sword-golden',
  equip_greatsword_t1: 'greatsword-big', equip_greatsword_t2: 'greatsword-katana', equip_greatsword_t3: 'greatsword-kaykit',
  equip_knife: 'knife-medieval', equip_dagger_t1: 'dagger-serrated', equip_dagger_t2: 'dagger-kaykit', equip_dagger_t3: 'dagger-golden',
  equip_bow_t1: 'bow-wooden', equip_bow_t2: 'bow-golden', equip_bow_t3: 'bow-evil',
  equip_staff_t1: 'staff-kaykit', equip_staff_t2: 'staff-ancient-gold', equip_staff_t3: 'staff-skeleton',
  equip_rod_t1: 'rod-kaykit', equip_rod_t2: 'rod-crystal', equip_rod_t3: 'rod-orb',
  equip_shield_t1: 'shield-round', equip_shield_t2: 'shield-heater', equip_shield_t3: 'shield-celtic-golden',
  equip_rune_t1: 'rune-orb-blue', equip_rune_t2: 'rune-orb-red', equip_rune_t3: 'rune-orb',
};

/** Non-Sketchfab sources (Sketchfab credits come from source/sketchfab/<uid>/meta.json, written by fetch-sources). */
export const SOURCES = {
  quaternius: { title: 'Modular Character Outfits – Fantasy (Standard)', author: 'Quaternius', license: 'CC0 1.0',
    url: 'https://quaternius.itch.io/modular-character-outfits-fantasy' },
  'kaykit:adventurers': { title: 'KayKit Character Pack: Adventurers 1.0', author: 'Kay Lousberg', license: 'CC0 1.0',
    url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0' },
  'weapons': { title: 'Medieval Weapons Pack', author: 'Quaternius', license: 'CC0 1.0', url: 'https://quaternius.com/packs/medievalweapons.html' },
  'kaykit:skeletons': { title: 'KayKit Character Pack: Skeletons 1.0', author: 'Kay Lousberg', license: 'CC0 1.0',
    url: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0' },
};
