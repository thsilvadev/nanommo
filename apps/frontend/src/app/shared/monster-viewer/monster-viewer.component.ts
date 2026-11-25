import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, effect, inject, input, output } from '@angular/core';
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
const ASSETS = '/assets/monsters/';
const isWeaponPart = (o: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.startsWith('weapon:')) return true; return false; };
/** A flinch lasts this long whatever the authored Damage clip (some run 3.5 s). */
const HIT_SECONDS = 0.5;
const CHARACTER_CLIPS = '/assets/character/animations.glb?v=3'; // keep in step with ANIMATIONS_ASSET
/** Character-rig monsters play the character library: our clip -> its clip. */
const CHARACTER_MAP: Record<MonsterClip, string> = { Idle: 'CombatIdle', Walk: 'Walk', Attack: 'Attack', Cast: 'Attack', Damage: 'Damage', Dead: 'Dead' };

type Three = typeof import('three');
interface Loaded { three: Three; gltf: (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>; clone: (o: THREE.Object3D) => THREE.Object3D }
let shared: Promise<Loaded> | null = null;
let manifest: Promise<Record<string, MonsterManifestEntry>> | null = null;
/** Battle ids are `mon_<name>` (monsters.json); the manifest is keyed by `<name>`. */
export const monsterManifestKey = (monsterId: string) => monsterId.replace(/^mon_/, '');
/** three.js and the loader are fetched on first use only; parsed files are shared by every viewer. */
function loadThree(): Promise<Loaded> {
  shared ??= Promise.all([import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/utils/SkeletonUtils.js')])
    .then(([three, { GLTFLoader }, { clone }]) => {
      const loader = new GLTFLoader(); const files = new Map<string, Promise<any>>();
      const gltf = (url: string) => { if (!files.has(url)) files.set(url, loader.loadAsync(url)); return files.get(url)!; };
      return { three, gltf, clone };
    });
  return shared;
}
/** How a monster's basic attack is animated: a character-rig monster holding a bow draws and looses it. */
export function monsterAttackStyle(entry: MonsterManifestEntry | null | undefined): AttackStyle {
  return entry?.rig === 'character' && !!entry.weapon?.startsWith('bow') ? 'bow' : 'melee';
}
export function loadMonsterManifest(): Promise<Record<string, MonsterManifestEntry>> { return loadManifest(); }
function loadManifest() {
  manifest ??= fetch(ASSETS + 'manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifest;
}

/**
 * A monster's 3D model in a small transparent canvas, posed every frame from
 * `animation(now)` (the battle log, see monster-animation-state.ts). Emits `loaded`
 * once it shows the model and `failed` when there is none (the caller keeps its sprite).
 */
@Component({
  selector: 'app-monster-viewer', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '', styles: [':host{display:block;position:relative;overflow:hidden}:host ::ng-deep canvas{display:block;width:100%!important;height:100%!important}'],
})
export class MonsterViewerComponent implements OnDestroy {
  readonly monsterId = input.required<string>();
  readonly animation = input.required<(nowMs: number) => MonsterAnimationState>();
  readonly loaded = output<void>();
  readonly failed = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private readonly zone = inject(NgZone);
  private renderer: THREE.WebGLRenderer | null = null;
  private frame = 0;
  private generation = 0;
  private resize: ResizeObserver | null = null;
  /** The shown model (tests read its pose). */
  private root: THREE.Object3D | null = null;
  /** The hand item of the shown model, if any (tests read it). */
  private weapon: MonsterWeapon | null = null;

  constructor() {
    effect(() => { const id = this.monsterId(); void this.show(id); });
  }

  ngOnDestroy(): void { this.generation++; cancelAnimationFrame(this.frame); this.resize?.disconnect(); this.renderer?.dispose(); this.renderer?.domElement.remove(); }

  private async show(id: string): Promise<void> {
    const gen = ++this.generation;
    cancelAnimationFrame(this.frame);
    try {
      const entry = (await loadManifest())[monsterManifestKey(id)];
      if (!entry?.file || entry.rig === 'char') throw new Error('no model');
      const { three, gltf, clone } = await loadThree();
      // A hand item is optional: without the gear files the monster still shows, empty-handed.
      const weaponKit = entry.rig === 'character' && entry.weapon
        ? import('./monster-weapon').then(async (m) => ({ m, gear: await m.loadMonsterWeaponGear() })).catch(() => null)
        : Promise.resolve(null);
      const [model, library, kit] = await Promise.all([gltf(ASSETS + entry.file), entry.rig === 'character' ? gltf(CHARACTER_CLIPS) : Promise.resolve(null), weaponKit]);
      if (gen !== this.generation) return;
      const arm = kit && entry.weapon ? (root: THREE.Object3D) => { try { return kit.m.attachMonsterWeapon(root, entry.weapon!, kit.gear); } catch { return null; } } : null;
      this.zone.runOutsideAngular(() => this.start(three, clone(model.scene), library ? library.animations : model.animations, entry.rig === 'character', gen, arm));
      this.loaded.emit();
    } catch {
      if (gen === this.generation) this.failed.emit();
    }
  }

  private start(three: Three, root: THREE.Object3D, clips: THREE.AnimationClip[], characterRig: boolean, gen: number, arm: ((root: THREE.Object3D) => MonsterWeapon | null) | null = null): void {
    if (!this.renderer) {
      this.renderer = new three.WebGLRenderer({ alpha: true, antialias: true });
      this.renderer.outputColorSpace = three.SRGBColorSpace;
      this.host.appendChild(this.renderer.domElement);
    }
    const renderer = this.renderer;
    const scene = new three.Scene();
    scene.add(new three.HemisphereLight('#ffffff', '#4a3a2a', 2.2));
    const sun = new three.DirectionalLight('#ffffff', 2); sun.position.set(-3, 6, 5); scene.add(sun);
    root.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    this.root = root;
    scene.add(root);

    const mixer = new three.AnimationMixer(root);
    const actions = new Map<MonsterClip, THREE.AnimationAction>();
    for (const name of ['Idle', 'Walk', 'Attack', 'Cast', 'Damage', 'Dead'] as MonsterClip[]) {
      const clip = clips.find((c) => c.name === (characterRig ? CHARACTER_MAP[name] : name));
      if (clip) { const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); actions.set(name, a); }
    }
    // Generated clips (tools/monster-assets) only move the top 'Monster' node: they play over the Idle body pose,
    // otherwise the limbs would freeze in whatever pose the previous clip left them.
    const rootOnly = new Set([...actions].filter(([, a]) => a.getClip().tracks.every((t) => t.name.startsWith('Monster.'))).map(([n]) => n));
    const pose = (name: MonsterClip, seconds: number, loop = false) => {
      const chosen = actions.get(name) ?? actions.get('Idle');
      const under = rootOnly.has(name) && name !== 'Idle' ? actions.get('Idle') : undefined;
      for (const a of actions.values()) a.setEffectiveWeight(a === chosen || a === under ? 1 : 0);
      if (chosen) { const d = chosen.getClip().duration; chosen.time = loop ? seconds % d : Math.min(Math.max(seconds, 0), d - 1e-3); }
      if (under) under.time = (Date.now() / 1000) % under.getClip().duration;
      mixer.update(0);
    };

    // frame the Idle pose: whole body, a little room above, turned toward the player (left)
    pose('Idle', 0);
    root.updateMatrixWorld(true);
    // framed without the weapon (a bow would widen the box), gripped on the Idle fist
    const weapon = arm?.(root) ?? null;
    this.weapon = weapon;
    const box = new three.Box3();
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !isWeaponPart(o)) box.expandByObject(o); });
    const size = box.getSize(new three.Vector3()), center = box.getCenter(new three.Vector3());
    const camera = new three.PerspectiveCamera(30, 1, 0.05, 200);
    const span = Math.max(size.y, size.x * 0.8, size.z * 0.8) * 1.35;
    const dist = span / (2 * Math.tan((15 * Math.PI) / 180));
    const yaw = (-35 * Math.PI) / 180;
    camera.position.set(center.x + Math.sin(yaw) * dist, center.y + span * 0.12, center.z + Math.cos(yaw) * dist);
    camera.lookAt(center.x, center.y, center.z);

    const fit = () => {
      const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    this.resize?.disconnect(); this.resize = new ResizeObserver(fit); this.resize.observe(this.host); fit();

    const duration = (name: MonsterClip) => (actions.get(name) ?? actions.get('Idle'))?.getClip().duration ?? 1;
    const tick = () => {
      if (gen !== this.generation) return;
      const now = Date.now(); const s = this.animation()(now);
      weapon?.restore();
      let shot: number | null = null;
      if (s.dead) pose('Dead', (now - s.dead.startedAtMs) / 1000);
      else if (weapon?.type === 'bow' && s.action?.clip === 'Attack' && now < s.action.endsAtMs) {
        // bow: the guard underneath, the arms drawn and loosed procedurally over it
        shot = Math.max(0, (now - s.action.startedAtMs) / Math.max(1, s.action.endsAtMs - s.action.startedAtMs));
        pose('Idle', now / 1000, true);
      } else {
        const a = s.action;
        // the clip is stretched over the action window (the blow, mid-clip, lands on the hit tick)
        const actionAt = a ? ((now - a.startedAtMs) / Math.max(1, a.endsAtMs - a.startedAtMs)) * duration(a.clip) : Infinity;
        const hitAt = s.hit ? ((now - s.hit.startedAtMs) / 1000 / HIT_SECONDS) * duration('Damage') : Infinity;
        if (a && actionAt < duration(a.clip)) pose(a.clip, actionAt);
        else if (hitAt < duration('Damage')) pose('Damage', hitAt);
        else if (s.walking && actions.has('Walk')) pose('Walk', now / 1000, true);
        else pose('Idle', now / 1000, true);
      }
      weapon?.pose(shot !== null && shot < 1 ? shot : null);
      renderer.render(scene, camera);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
