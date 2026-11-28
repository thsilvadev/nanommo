/**
 * One entry per monster of monsters.json. Sources are in picks.json (Sketchfab uid) unless `source` says otherwise.
 *
 * kind 'native'    — keeps the model's rig; `clips` maps our clip names to the source clip names
 *                    (missing Damage/Dead/Attack are generated on a wrapper node; Cast falls back to Attack).
 *                    `split`: { NewName: [sourceClip, t0, t1] } cuts a clip out of a long take first.
 * kind 'character' — humanoid moved onto our character skeleton (retarget | autoskin); plays the
 *                    character animation library at runtime.
 * kind 'char'      — no GLB: the regular character model with `character` (appearance + equipment).
 *
 * size: { h } height or { len } longest horizontal extent, in metres (the character is ~1.75 m).
 * rotY: degrees to turn the model so it faces +Z. rev: cache-busting version of a GLB rebuilt in place. tint: [r,g,b] multiplier on every material. alpha: 0..1 makes every material see-through (blended, front faces only)
 * (or { match: /material name/, rgb }). recolor: hue-range swaps on textures. attach: cones on bones.
 * fx: runtime effects for the arena (not built here).
 */
export const MONSTERS = {
  // A pink, half-see-through jelly: the dark green texture greyed and brightened, then tinted pink.
  slime: { kind: 'native', size: { h: 0.7 }, rev: 2, clips: {Walk: 'Walk',  Idle: 'Idle', Attack: 'Attack1', Damage: 'Damage', Dead: 'Death', Cast: 'Pulse' }, hue: { s: 0.2, b: 2.6 }, tint: [1, 0.34, 0.86], alpha: 0.72 },
  fieldbat: { kind: 'native', size: { len: 2.2 }, clips: {Walk: '2legsWalk',  Idle: '2legsIdle', Attack: '2legsWingAttackR', Dead: '2legsDeath', Cast: '2legsRoar' } },
  mutantbee: { kind: 'native', size: { len: 1.2 }, clips: {Walk: '_bee_hover',  Idle: '_bee_hover' }, maxTris: 15000 },
  thornsprout: { kind: 'native', size: { h: 1.3 }, clips: { Idle: 'Idle', Attack: 'Bite', Dead: 'Dying', Cast: 'Spit' } },
  mudcrawler: { kind: 'native', size: { len: 1.6 }, clips: {Walk: 'rig|walk',  Idle: 'rig|Idle', Attack: 'rig|attack', Cast: 'rig|Roar' }, keep: { PowerAttack: 'rig|Powerfull_attack' }, hue: { h: 210, s: 0.8, b: 0.85 }, fx: ['leaves'], dropMorph: true },
  direwolf: { kind: 'native', size: { len: 2.0 }, clips: {Walk: 'magic_wolf|walk',  Idle: 'magic_wolf|Idle', Attack: 'magic_wolf|claw attack', Damage: 'magic_wolf|damage', Cast: 'magic_wolf|flame thrower' } },
  gravelhorn: { kind: 'native', size: { len: 3.2 }, clips: {Walk: 'walk',  Idle: 'idle', Attack: 'attack1', Dead: 'die', Cast: 'attack2' } },
  mudflatcrocodile: { kind: 'native', size: { len: 3.5 }, clips: {Walk: 'walk',  Idle: 'idle', Attack: 'attack', Damage: 'hit', Dead: 'Death', Cast: 'Attack01' } },
  sandscorpion: { kind: 'native', size: { len: 2.2 }, clips: {Walk: 'walkForward',  Idle: 'idle', Attack: 'doubleClawsAttack', Dead: 'death', Cast: 'stingerAttack' } },
  ridgebreaker: { kind: 'native', size: { h: 2.8 }, clips: {Walk: 'Run',  Idle: 'Idle', Attack: 'PrimaryAttack_RA', Damage: 'HitReact_Front', Dead: 'Death_B', Cast: 'PrimaryAttack_LA' }, stone: [0.56, 0.55, 0.52], mottle: { color: [0.3, 0.5, 0.2], amount: 0.6 },
    attach: [{ bone: /^upperarm_[lr]_0\d\d$/, ring: { count: 9, radius: 0.14 }, offset: [0, 0.17, 0], length: 0.2, radius: 0.035, dir: [0, -1, 0], color: [0.95, 0.95, 0.92] }] },
  saltfangcrab: { kind: 'native', size: { len: 1.8 }, clips: {Walk: 'walkRight',  Idle: 'idle', Attack: 'ClawAttackLeft', Dead: 'death', Cast: 'clawAttackRight' } },
  needlebackstalker: { kind: 'native', size: { len: 2.0 }, clips: {Walk: '4legsWalk',  Idle: '4legsIdle', Attack: '4legsClawsAttackR', Damage: '4legsGetHit', Dead: '4legsDeath', Cast: '4legsHorntAttack' }, keep: { Bite: '4legsSnakeBiteAttack' }, hue: { h: 125, s: 0.8, b: 0.8 }, attach: [0, -0.12, 0.12].map((z) => ({ bone: /CHIMERA_ (Pelvis|Spine|Spine1|Neck)_/, length: 0.35, radius: 0.03, dir: [0, 1, -0.7], offset: [0, 0.22, z], spread: 0.07, color: [0.8, 0.82, 0.75] })) },
  giantspider: { kind: 'native', size: { len: 2.8 }, clips: {Walk: 'Armature|walk',  Idle: 'Armature|idle', Attack: 'Armature|attack', Dead: 'Armature|die' } },
  duneraider: { kind: 'native', size: { h: 1.8 }, clips: { Idle: 'emp_officer_alert_weightshift', Attack: 'emp_tuskenraider_atk_gaderffi_lunge', Damage: 'emp_officer_rct_stumbleb', Dead: 'emp_tuskenraider_rct_splatb', Cast: 'emp_officer_atk_larm_throw_upper' } },
  venomviper: { kind: 'native', size: { h: 1.5 }, rotY: -90, rev: 2, clips: { Idle: 'Idle', Attack: 'Bite', Dead: 'Killed', Cast: 'Attack2' }, hue: { h: 85, s: 1.3 } },
  bandit: { kind: 'char', character: { sex: 'male', heightCm: 178,
    appearance: { v: 1, hair: 1, hairColor: 0, skin: 2, face: 1, nose: 0, mouth: 0, mouthDetails: 0, chest: 0, facialHair: 2, piercing: 0, tattoo: 0 },
    equipment: { body: 'equip_body_phys_t1', head: 'equip_head_phys_t1', cape: 'equip_cape_phys_t1', shoes: 'equip_shoes_earth_t2', mainHand: 'equip_dagger_t1' }, mainHandType: 'dagger' } },
  giantmosquito: { kind: 'native', size: { len: 1.4 }, clips: {Walk: 'fly',  Idle: 'hover', Attack: 'attack', Dead: 'death1' } },
  rootboundbrute: { kind: 'native', size: { h: 2.6 }, clips: {Walk: 'walk',  Idle: 'idle', Attack: 'attack1', Damage: 'take_damage', Dead: 'death', Cast: 'attack2' } },
  unicorn: { kind: 'native', size: { h: 2.1 }, clips: {}, split: { Idle: ['Animations', 0, 5], Walk: ['Animations', 45.5, 48.5], Attack: ['Animations', 42.3, 43.4], Damage: ['Animations', 43.6, 44.5], Dead: ['Animations', 38.8, 40.2] }, hue: { h: 0, s: 0.15, b: 2.3 }, attach: [{ bone: /Head_06/, length: 1.35, radius: 0.1, dir: [0, 0.8, 1], offset: [0, 0.12, 0.1], color: [0.95, 0.85, 0.55] }] },
  kwaiouaranger: { kind: 'character', method: 'retarget', sex: 'female', recolor: 'goldToGreen', weapon: 'bow-wooden' },
  giantmantis: { kind: 'native', size: { h: 1.8 }, clips: {Walk: 'mantis_walk',  Idle: 'mantis_idle', Attack: 'mantis_attack', Damage: 'mantis_gothit', Dead: 'mantis_death' }, hue: { h: 20, s: 0.8 }, tint: [0.95, 0.8, 1.0] },
  flamingtreant: { kind: 'character', method: 'retarget', boneMap: 'treeman', sex: 'male', scale: 1.6, fx: ['fire'] },
  moonleafarcanist: { kind: 'character', method: 'retarget', boneMap: 'plague', sex: 'male', scale: 1.05 },
  mirageStalker: { kind: 'native', size: { len: 2.2 }, clips: {Walk: 'Walk',  Idle: 'Idle', Attack: 'Attack', Damage: 'Growl', Dead: 'Death', Cast: 'PounceSwipe' }, keep: { Bite: 'Bite' }, fx: ['aura', 'turquoise-eyes'] },
  arcanewisp: { kind: 'native', size: { len: 1.6 }, clips: {Walk: 'Armature|Swim',  Idle: 'Armature|Idle', Attack: 'Armature|Intimidate', Damage: 'Armature|Brace_Enter', Dead: 'Armature|Die', Cast: 'Armature|Brace_Idle' }, fx: ['blue-fire-aura'] },
  sacredforestguardian: { kind: 'native', size: { h: 3.0 }, clips: { Idle: 'ArmatureAction' }, maxTris: 30000 },
  aramaianwarden: { kind: 'native', size: { h: 2.8 }, clips: {Walk: 'Walk',  Idle: 'Idle', Attack: 'Attack1', Damage: 'Defence2', Dead: 'Defence3', Cast: 'Attack3' }, hue: { h: 190, s: 0.45, b: 0.95 } },
  ruinsguardian: { kind: 'native', size: { h: 3.2 }, clips: {Walk: 'Walk',  Idle: 'Idle', Attack: 'Attack1', Damage: 'Defence2', Dead: 'Defence3', Cast: 'Attack3' }, hue: { h: 240, s: 0.6, b: 0.9 } },
  boneknight: { kind: 'native', size: { h: 1.9 }, clips: {Walk: 'Lesha_walk',  Idle: 'Lesha_idle', Attack: 'Lesha_attack_1', Damage: 'Lesha_hitted_2' }, maxTris: 20000 },
  brokensentinel: { kind: 'native', size: { h: 2.6 }, clips: {Walk: 'root|Walk',  Idle: 'root|Idle', Attack: 'root|Attack', Damage: 'root|Damage', Dead: 'root|Death' }, tint: [1.0, 0.88, 0.68] },
  cindergolem: { kind: 'native', size: { h: 2.8 }, clips: {Walk: 'magmagolem_walk',  Idle: 'magmagolem_combatidle', Attack: 'magmagolem_chpunch', Damage: 'magmagolem_hit', Cast: 'magmagolem_sprayl' }, split: { Dead: ['Action_AnimDie__magmagolem_death1', 0, 1.25] }, keep: { FireBreath: 'magmagolem_firebreath', ThrowMagma: 'magmagolem_throwmagma' } },
  wraith: { kind: 'native', size: { h: 0.45 }, lift: 1.35, clips: { Idle: 'Take 01' }, attach: [{ bone: /^Cube$/, ring: { count: 14, radius: 0.18 }, offset: [0, -0.05, 0], length: 0.8, radius: 0.045, dir: [0, -1, 0], color: [0.3, 0.6, 1.0], emissive: [0.15, 0.45, 1.0], alpha: 0.45, pulse: true }], fx: ['blue-melting-particles'] },
};

/** Town NPC figures built by the same pipeline (output: apps/frontend/public/assets/npcs/figure-<id>.glb, Idle only). */
export const NPC_FIGURES = {
  yunara: { kind: 'native', size: { h: 1.66 }, clips: { Idle: 'Idle1' }, onlyIdle: true, uid: '6a3a4af54f22442cb272309c91220015' },
};
