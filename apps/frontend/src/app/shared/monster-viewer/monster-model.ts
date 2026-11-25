/**
 * One monster's 3D model, posed from a MonsterAnimationState — renderer-free, so the
 * grind-panel portrait (one monster, its own canvas) and the battle arena (many
 * monsters, one scene) share the loading and the clip rules.
 *
 * three.js is only imported as types here and loaded on first use; parsed files are
 * shared by every model (each model is a skeleton clone).
 */
import type * as THREE from 'three';
import type { AttackStyle } from '../character-animation/animation-state';
import type { MonsterAnimationState, MonsterClip } from './monster-animation-state';
import type { MonsterWeapon } from './monster-weapon';

/** /assets/monsters/manifest.json entry (tools/monster-assets). */
export interface MonsterManifestEntry {
  file?: string; rig: 'native' | 'character' | 'char';
  /** rig 'character': gear visual held in the hand (tools/monster-assets `weapon`, e.g. `bow-wooden` = Yew Bow T1). */
  weapon?: string;
  /** rig 'char': drawn as a regular character wearing this gear. */
  character?: { sex: 'male' | 'female'; heightCm: number; appearance: Record<string, number> & { v: 1 }; equipment: Record<string, string>; mainHandType?: string };
}
export const MONSTER_ASSETS = '/assets/monsters/';
const isWeaponPart = (o: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.startsWith('weapon:')) return true; return false; };
/** A flinch lasts this long whatever the authored Damage clip (some run 3.5 s). */
const HIT_SECONDS = 0.5;
const CHARACTER_CLIPS = '/assets/character/animations.glb?v=3'; // keep in step with ANIMATIONS_ASSET
/** Character-rig monsters play the character library: our clip -> its clip. */
const CHARACTER_MAP: Record<MonsterClip, string> = { Idle: 'CombatIdle', Walk: 'Walk', Attack: 'Attack', Cast: 'Attack', Damage: 'Damage', Dead: 'Dead' };
const CLIPS: MonsterClip[] = ['Idle', 'Walk', 'Attack', 'Cast', 'Damage', 'Dead'];

export type Three = typeof import('three');
interface Loaded { three: Three; gltf: (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>; clone: (o: THREE.Object3D) => THREE.Object3D }
let shared: Promise<Loaded> | null = null;
let manifest: Promise<Record<string, MonsterManifestEntry>> | null = null;
/** Battle ids are `mon_<name>` (monsters.json); the manifest is keyed by `<name>`. */
export const monsterManifestKey = (monsterId: string) => monsterId.replace(/^mon_/, '');
/** three.js and the loader are fetched on first use only; parsed files are shared by every model. */
export function loadMonsterThree(): Promise<Loaded> {
  shared ??= Promise.all([import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/utils/SkeletonUtils.js')])
    .then(([three, { GLTFLoader }, { clone }]) => {
      const loader = new GLTFLoader(); const files = new Map<string, Promise<any>>();
      const gltf = (url: string) => {
        if (!files.has(url)) { const p = loader.loadAsync(url); p.catch(() => files.delete(url)); files.set(url, p); }
        return files.get(url)!;
      };
      return { three, gltf, clone };
    });
  return shared;
}
/** How a monster's basic attack is animated: a character-rig monster holding a bow draws and looses it. */
export function monsterAttackStyle(entry: MonsterManifestEntry | null | undefined): AttackStyle {
  return entry?.rig === 'character' && !!entry.weapon?.startsWith('bow') ? 'bow' : 'melee';
}
export function loadMonsterManifest(): Promise<Record<string, MonsterManifestEntry>> {
  manifest ??= fetch(MONSTER_ASSETS + 'manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifest;
}

export class MonsterModel {
  private constructor(
    private readonly three: Three,
    /** The posed root (a skeleton clone of the species file, or a placeholder capsule). */
    readonly object3d: THREE.Object3D,
    private readonly mixer: THREE.AnimationMixer | null,
    private readonly actions: Map<MonsterClip, THREE.AnimationAction>,
    private hand: MonsterWeapon | null,
    /** Body bounds in the Idle pose, without the hand item (a bow would widen it). */
    readonly frameBox: THREE.Box3,
    readonly placeholder: boolean,
    private readonly owned: Array<{ dispose(): void }> = [],
  ) {}

  /** The hand item, if any (character-rig monsters). */
  get weapon(): MonsterWeapon | null { return this.hand; }

  /** Native size in metres (Idle pose, without the hand item). */
  get nativeSize(): { width: number; height: number } {
    const size = this.frameBox.getSize(new this.three.Vector3());
    return { width: Math.max(size.x, size.z), height: size.y };
  }

  /** Rejects when the species has no model of its own (no manifest entry, no file, or drawn as a character). */
  static async load(monsterId: string): Promise<MonsterModel> {
    const entry = (await loadMonsterManifest())[monsterManifestKey(monsterId)];
    if (!entry?.file || entry.rig === 'char') throw new Error(`no model for ${monsterId}`);
    const { three, gltf, clone } = await loadMonsterThree();
    // A hand item is optional: without the gear files the monster still shows, empty-handed.
    const weaponKit = entry.rig === 'character' && entry.weapon
      ? import('./monster-weapon').then(async (m) => ({ m, gear: await m.loadMonsterWeaponGear() })).catch(() => null)
      : Promise.resolve(null);
    const [model, library, kit] = await Promise.all([gltf(MONSTER_ASSETS + entry.file), entry.rig === 'character' ? gltf(CHARACTER_CLIPS) : Promise.resolve(null), weaponKit]);
    const root = clone(model.scene);
    root.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    const clips = library ? library.animations : model.animations;
    const mixer = new three.AnimationMixer(root);
    const actions = new Map<MonsterClip, THREE.AnimationAction>();
    for (const name of CLIPS) {
      const clip = clips.find((c) => c.name === (entry.rig === 'character' ? CHARACTER_MAP[name] : name));
      if (clip) { const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); actions.set(name, a); }
    }
    const instance = new MonsterModel(three, root, mixer, actions, null, new three.Box3(), false);
    // Framed in the Idle pose, without the weapon, gripped on the Idle fist.
    instance.pose('Idle', 0, false, 0);
    root.updateMatrixWorld(true);
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !isWeaponPart(o)) instance.frameBox.expandByObject(o); });
    if (kit && entry.weapon) { try { instance.hand = kit.m.attachMonsterWeapon(root, entry.weapon, kit.gear); } catch { instance.hand = null; } }
    return instance;
  }

  /** The species model, or a grey capsule when it has none (never throws). */
  static async loadOrPlaceholder(monsterId: string): Promise<MonsterModel> {
    try { return await MonsterModel.load(monsterId); } catch { return MonsterModel.placeholderModel((await loadMonsterThree()).three); }
  }

  static placeholderModel(three: Three): MonsterModel {
    const geometry = new three.CapsuleGeometry(0.4, 0.7, 4, 12);
    const material = new three.MeshStandardMaterial({ color: '#8a8f99', roughness: 0.8 });
    const mesh = new three.Mesh(geometry, material);
    mesh.position.y = 0.75;
    const root = new three.Group();
    root.name = 'monster:placeholder';
    root.add(mesh);
    const box = new three.Box3().setFromObject(root);
    return new MonsterModel(three, root, null, new Map(), null, box, true, [geometry, material]);
  }

  clipNames(): string[] { return [...this.actions.keys()]; }
  playingClip(): string | null {
    let best: string | null = null, weight = 0;
    // A generated clip plays over the Idle body (both at weight 1): the clip on top wins the tie.
    for (const [name, a] of this.actions) if (a.getEffectiveWeight() > weight || (a.getEffectiveWeight() === weight && weight > 0 && name !== 'Idle')) { weight = a.getEffectiveWeight(); best = name; }
    return best;
  }
  clipTime(name: MonsterClip): number { return this.actions.get(name)?.time ?? 0; }
  clipDuration(name: MonsterClip): number { return (this.actions.get(name) ?? this.actions.get('Idle'))?.getClip().duration ?? 1; }

  /** Pose the model for `state` at `nowMs` (the portrait's rules: clip stretched over the action window). */
  drive(s: MonsterAnimationState, nowMs: number): void {
    if (!this.mixer) { this.object3d.position.y = s.dead ? -0.2 : Math.sin(nowMs / 400) * 0.03; return; }
    const weapon = this.weapon;
    weapon?.restore();
    let shot: number | null = null;
    if (s.dead) this.pose('Dead', (nowMs - s.dead.startedAtMs) / 1000, false, nowMs);
    else if (weapon?.type === 'bow' && s.action?.clip === 'Attack' && nowMs < s.action.endsAtMs) {
      // bow: the guard underneath, the arms drawn and loosed procedurally over it
      shot = Math.max(0, (nowMs - s.action.startedAtMs) / Math.max(1, s.action.endsAtMs - s.action.startedAtMs));
      this.pose('Idle', nowMs / 1000, true, nowMs);
    } else {
      const a = s.action;
      // the clip is stretched over the action window (the blow, mid-clip, lands on the hit tick)
      const actionAt = a ? ((nowMs - a.startedAtMs) / Math.max(1, a.endsAtMs - a.startedAtMs)) * this.clipDuration(a.clip) : Infinity;
      const hitAt = s.hit ? ((nowMs - s.hit.startedAtMs) / 1000 / HIT_SECONDS) * this.clipDuration('Damage') : Infinity;
      if (a && actionAt < this.clipDuration(a.clip)) this.pose(a.clip, actionAt, false, nowMs);
      else if (hitAt < this.clipDuration('Damage')) this.pose('Damage', hitAt, false, nowMs);
      else if (s.walking && this.actions.has('Walk')) this.pose('Walk', nowMs / 1000, true, nowMs);
      else this.pose('Idle', nowMs / 1000, true, nowMs);
    }
    weapon?.pose(shot !== null && shot < 1 ? shot : null);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.object3d);
    this.object3d.removeFromParent();
    for (const item of this.owned) item.dispose();
  }

  /** Generated clips (tools/monster-assets) only move the top 'Monster' node: they play over the Idle body pose. */
  private rootOnly(name: MonsterClip): boolean {
    const a = this.actions.get(name);
    return !!a && a.getClip().tracks.every((t) => t.name.startsWith('Monster.'));
  }

  private pose(name: MonsterClip, seconds: number, loop: boolean, nowMs: number): void {
    const chosen = this.actions.get(name) ?? this.actions.get('Idle');
    const under = this.rootOnly(name) && name !== 'Idle' ? this.actions.get('Idle') : undefined;
    for (const a of this.actions.values()) a.setEffectiveWeight(a === chosen || a === under ? 1 : 0);
    if (chosen) { const d = chosen.getClip().duration; chosen.time = loop ? seconds % d : Math.min(Math.max(seconds, 0), d - 1e-3); }
    if (under) under.time = (nowMs / 1000) % under.getClip().duration;
    this.mixer!.update(0);
  }
}
