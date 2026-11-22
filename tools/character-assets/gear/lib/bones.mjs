/** Source rig bone names (Mixamo, 3ds Max Biped, Rigify, Reallusion CC, generic Blender) -> our bone names. */

const ALIASES = {
  pelvis: ['hips', 'pelvis', 'bippelvis', 'def-pelvis', 'cc_base_hip'],
  spine_01: ['spine', 'bipspine', 'def-spine', 'spine_mid', 'cc_base_waist'],
  spine_02: ['spine1', 'bipspine1', 'def-chest', 'cc_base_spine01'],
  spine_03: ['spine2', 'bipspine2', 'cc_base_spine02'],
  neck_01: ['neck', 'bipneck', 'def-neck', 'cc_base_necktwist01'],
  Head: ['head', 'biphead', 'def-head', 'cc_base_head'],
};
const SIDED = {
  clavicle: ['{L}shoulder', 'bip{s}clavicle', 'def-shoulder{.s}', 'shoulder{.s}', 'cc_base_{s}_clavicle'],
  upperarm: ['{L}arm', 'bip{s}upperarm', 'def-arm{.s}', 'bicept{.s}', 'cc_base_{s}_upperarm'],
  lowerarm: ['{L}forearm', 'bip{s}forearm', 'def-forearm{.s}', 'forarm{.s}', 'cc_base_{s}_forearm'],
  hand: ['{L}hand', 'bip{s}hand', 'def-hand{.s}', 'hand{.s}', 'cc_base_{s}_hand'],
  thigh: ['{L}upleg', 'bip{s}thigh', 'def-leg{.s}', 'thigh{.s}', 'cc_base_{s}_thigh'],
  calf: ['{L}leg', 'bip{s}calf', 'def-shin{.s}', 'shin{.s}', 'cc_base_{s}_calf'],
  foot: ['{L}foot', 'bip{s}foot', 'def-foot{.s}', 'foot{.s}', 'cc_base_{s}_foot'],
  ball: ['{L}toebase', 'bip{s}toe0', 'def-toes{.s}', 'toes{.s}', 'cc_base_{s}_toebase'],
  ...Object.fromEntries(['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) =>
    [1, 2, 3].map((k) => [`${f}_0${k}`, [`{L}hand${f}${k}`]]))),
};

const ALIAS_TO_TARGET = new Map();
for (const [t, list] of Object.entries(ALIASES)) for (const a of list) ALIAS_TO_TARGET.set(a, t);
for (const [base, list] of Object.entries(SIDED)) for (const s of ['l', 'r']) for (const a of list) {
  ALIAS_TO_TARGET.set(a.replace('{L}', s === 'l' ? 'left' : 'right').replace('{s}', s).replace('{.s}', `.${s}`), `${base}_${s}`);
}

/** 'mixamorig:LeftUpLeg_016' -> 'leftupleg'; 'Thigh.R.001_048' -> 'thigh.r'; 'bip L UpperArm_08' -> 'biplupperarm'. */
export function normalizeBoneName(name) {
  return name
    .replace(/^mixamorig\d*:/i, '')
    .replace(/\.([LR])\.\d{3}(_\d+)?$/i, '.$1')
    .replace(/_\d+$/, '').replace(/_\d+$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** Our bone for a source bone name, or undefined. */
export function targetBoneFor(name) { return ALIAS_TO_TARGET.get(normalizeBoneName(name)); }

/**
 * First source joint per target bone wins (helper duplicates such as Shin.L.001 are left unmapped).
 * `exact`: our own bone names — a rig that already uses them (Quaternius) maps each bone to itself.
 */
export function mapSourceBones(joints, exact = new Set()) {
  const map = new Map();
  const taken = new Set();
  for (const j of joints) {
    const t = exact.has(j.getName()) ? j.getName() : targetBoneFor(j.getName());
    if (t && !taken.has(t)) { map.set(j, t); taken.add(t); }
  }
  return map;
}
