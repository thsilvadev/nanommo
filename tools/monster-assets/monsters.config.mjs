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
 * rotY: degrees to turn the model so it faces +Z. tint: [r,g,b] multiplier on every material
 * (or { match: /material name/, rgb }). recolor: hue-range swaps on textures. attach: cones on bones.
 * fx: runtime effects for the arena (not built here).
 */
export const MONSTERS = {
  slime: { kind: 'native', size: { h: 0.7 }, clips: { Idle: 'Idle', Attack: 'Attack1', Damage: 'Damage', Dead: 'Death', Cast: 'Pulse' }, tint: [0.55, 1.15, 0.35] },
  fieldbat: { kind: 'native', size: { len: 2.2 }, clips: { Idle: '2legsIdle', Attack: '2legsWingAttackR', Dead: '2legsDeath', Cast: '2legsRoar' } },
  mutantbee: { kind: 'native', size: { len: 1.2 }, clips: { Idle: '_bee_hover' }, maxTris: 15000 },
  thornsprout: { kind: 'native', size: { h: 1.3 }, clips: { Idle: 'Idle', Attack: 'Bite', Dead: 'Dying', Cast: 'Spit' } },
  mudcrawler: { kind: 'native', size: { len: 1.6 }, clips: { Idle: 'rig|Idle', Attack: 'rig|attack', Cast: 'rig|Roar' }, keep: { PowerAttack: 'rig|Powerfull_attack' }, hue: { h: 180, s: 0.7, b: 0.85 }, fx: ['leaves'], dropMorph: true },
  direwolf: { kind: 'native', size: { len: 2.0 }, clips: { Idle: 'magic_wolf|Idle', Attack: 'magic_wolf|claw attack', Damage: 'magic_wolf|damage', Cast: 'magic_wolf|flame thrower' } },
  gravelhorn: { kind: 'native', size: { len: 3.2 }, clips: { Idle: 'idle', Attack: 'attack1', Dead: 'die', Cast: 'attack2' } },
  mudflatcrocodile: { kind: 'native', size: { len: 3.5 }, clips: { Idle: 'idle', Attack: 'attack', Damage: 'hit', Dead: 'Death', Cast: 'Attack01' } },
  sandscorpion: { kind: 'native', size: { len: 2.2 }, clips: { Idle: 'idle', Attack: 'doubleClawsAttack', Damage: 'buff1', Dead: 'death', Cast: 'stingerAttack' } },
  ridgebreaker: { kind: 'native', size: { h: 2.8 }, clips: { Idle: 'Idle', Attack: 'PrimaryAttack_RA', Damage: 'HitReact_Front', Dead: 'Death_B', Cast: 'PrimaryAttack_LA' } },
  saltfangcrab: { kind: 'native', size: { len: 1.8 }, clips: { Idle: 'idle', Attack: 'ClawAttackLeft', Dead: 'death', Cast: 'clawAttackRight' } },
  needlebackstalker: { kind: 'native', size: { len: 2.0 }, clips: { Idle: '4legsIdle', Attack: '4legsClawsAttackR', Damage: '4legsGetHit', Dead: '4legsDeath', Cast: '4legsHorntAttack' }, keep: { Bite: '4legsSnakeBiteAttack' }, hue: { h: 125, s: 0.8, b: 0.8 }, attach: [0, -0.12, 0.12].map((z) => ({ bone: /CHIMERA_ (Pelvis|Spine|Spine1|Neck)_/, length: 0.35, radius: 0.03, dir: [0, 1, -0.7], offset: [0, 0.22, z], spread: 0.07, color: [0.8, 0.82, 0.75] })) },
  giantspider: { kind: 'native', size: { len: 2.8 }, clips: { Idle: 'Armature|idle', Attack: 'Armature|attack', Dead: 'Armature|die' } },
  duneraider: { kind: 'native', size: { h: 1.8 }, clips: { Idle: 'emp_officer_alert_weightshift', Attack: 'emp_tuskenraider_atk_gaderffi_lunge', Damage: 'emp_officer_rct_stumbleb', Dead: 'emp_tuskenraider_rct_splatb', Cast: 'emp_officer_atk_larm_throw_upper' } },
  venomviper: { kind: 'native', size: { h: 1.5 }, clips: { Idle: 'Idle', Attack: 'Bite', Dead: 'Killed', Cast: 'Attack2' } },
  bandit: { kind: 'char', character: { sex: 'male', gear: ['body-ranger', 'head-rogue-hood', 'cape-rogue', 'shoes-peasant'], weapon: 'dagger-serrated' } },
  giantmosquito: { kind: 'native', size: { len: 1.4 }, clips: { Idle: 'hover', Attack: 'attack', Dead: 'death1' } },
  rootboundbrute: { kind: 'native', size: { h: 2.6 }, clips: { Idle: 'idle', Attack: 'attack1', Damage: 'take_damage', Dead: 'death', Cast: 'attack2' } },
  unicorn: { kind: 'native', size: { h: 2.1 }, clips: {}, split: { Idle: ['Animations', 0, 4], Attack: ['Animations', 33.2, 35.4], Dead: ['Animations', 38.8, 40.2] }, hue: { h: 0, s: 0.15, b: 2.3 }, attach: [{ bone: /Head_06/, length: 0.45, radius: 0.05, dir: [0, 0.8, 1], offset: [0, 0.12, 0.1], color: [0.95, 0.85, 0.55] }] },
  kwaiouaranger: { kind: 'character', method: 'retarget', sex: 'female', recolor: 'goldToGreen', weapon: 'bow-wooden' },
  giantmantis: { kind: 'native', size: { h: 1.8 }, clips: { Idle: 'mantis_idle', Attack: 'mantis_attack', Damage: 'mantis_gothit', Dead: 'mantis_death' }, hue: { h: 20, s: 0.8 }, tint: [0.95, 0.8, 1.0] },
  flamingtreant: { kind: 'character', method: 'retarget', boneMap: 'treeman', sex: 'male', scale: 1.6, fx: ['fire'] },
  moonleafarcanist: { kind: 'character', method: 'retarget', boneMap: 'plague', sex: 'male', scale: 1.05 },
  mirageStalker: { kind: 'native', size: { len: 2.2 }, clips: { Idle: 'Idle', Attack: 'Attack', Damage: 'Growl', Dead: 'Death', Cast: 'PounceSwipe' }, keep: { Bite: 'Bite' }, fx: ['aura', 'turquoise-eyes'] },
  arcanewisp: { kind: 'native', size: { len: 1.6 }, clips: { Idle: 'Armature|Idle', Attack: 'Armature|Intimidate', Damage: 'Armature|Brace_Enter', Dead: 'Armature|Die', Cast: 'Armature|Brace_Idle' }, fx: ['blue-fire-aura'] },
  sacredforestguardian: { kind: 'native', size: { h: 3.0 }, clips: { Idle: 'ArmatureAction' }, maxTris: 30000 },
  aramaianwarden: { kind: 'native', size: { h: 2.8 }, clips: { Idle: 'Idle', Attack: 'Attack1', Damage: 'Defence2', Dead: 'Defence3', Cast: 'Attack3' }, hue: { h: 190, s: 0.45, b: 0.95 } },
  ruinsguardian: { kind: 'native', size: { h: 3.2 }, clips: { Idle: 'Idle', Attack: 'Attack1', Damage: 'Defence2', Dead: 'Defence3', Cast: 'Attack3' }, hue: { h: 240, s: 0.6, b: 0.9 } },
  boneknight: { kind: 'native', source: 'kaykit:Skeleton_Warrior.glb', size: { h: 1.9 }, clips: { Idle: 'Idle_Combat', Attack: '1H_Melee_Attack_Chop', Damage: 'Hit_A', Dead: 'Death_A', Cast: 'Spellcast_Shoot' }, props: [{ file: 'Skeleton_Blade.gltf', bone: 'handslot.r' }, { file: 'Skeleton_Shield_Large_A.gltf', bone: 'handslot.l' }] },
  brokensentinel: { kind: 'native', size: { h: 2.6 }, clips: { Idle: 'root|Idle', Attack: 'root|Attack', Damage: 'root|Damage', Dead: 'root|Death' }, tint: [1.0, 0.88, 0.68] },
  cindergolem: { kind: 'native', size: { h: 2.8 }, clips: { Idle: 'magmagolem_combatidle', Attack: 'magmagolem_chpunch', Damage: 'magmagolem_hit', Cast: 'magmagolem_sprayl' }, split: { Dead: ['Action_AnimDie__magmagolem_death1', 0, 1.25] }, keep: { FireBreath: 'magmagolem_firebreath', ThrowMagma: 'magmagolem_throwmagma' } },
  wraith: { kind: 'native', size: { h: 1.1 }, lift: 0.7, clips: { Idle: 'Take 01' }, fx: ['blue-melting-particles'] },
};
