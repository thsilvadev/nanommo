/**
 * One combatant in the arena scene: its model (a dressed character, a monster, or a
 * placeholder until/unless one loads), posed from its ArenaActorFrame, plus what the
 * frame says around it — blob shadow, cast ring, stun stars, sleep z's, ice block,
 * hit flash, exit (sink and fade).
 */
import * as THREE from 'three';
import { defaultAppearance, type TownRosterEntry } from '@nanommo/shared';
import type { AnimationState } from '../../../shared/character-animation/animation-state';
import { animationStateToMonster } from '../../../shared/monster-viewer/monster-animation-state';
import { MonsterModel, loadMonsterManifest, monsterManifestKey, type MonsterManifestEntry } from '../../../shared/monster-viewer/monster-model';
import { TownCharacter, type TownCharacterFactory } from '../town-scene/town-character';
import type { ArenaFlash } from '../../../shared/battle-feedback-style';
import type { ArenaActorFrame, ArenaFeedback } from './arena-actions';
import { monsterScale } from './arena-camera';
import type { ArenaCharacterLook, ArenaTeam } from './arena.types';

/** What the runtime needs to draw an actor (from ArenaActorDef, or a walking party member). */
export interface ArenaActorVisual {
  id: string; team: ArenaTeam; kind: 'character' | 'monster' | 'pet'; name: string;
  look: ArenaCharacterLook | null; monsterId: string | null;
}

const FLASH_COLORS: Record<ArenaFlash, string> = { white: '#ffffff', red: '#ff3b3b', green: '#4dff6a', orange: '#ff9a2e', darkred: '#6b0000' };
const FLASH_MS = 180;
const TEAM_RING: Record<ArenaTeam, string> = { a: '#ffcf5a', b: '#c070ff' };

// ---- shared, page-wide pieces -------------------------------------------------
let blobTexture: THREE.CanvasTexture | null = null;
function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer); g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function blob(): THREE.CanvasTexture { return (blobTexture ??= radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')); }
const textures = new Map<string, THREE.CanvasTexture>();
/** A glyph (★, z, Z) drawn once into a texture. */
function glyph(text: string, color: string, stroke: string): THREE.CanvasTexture {
  const key = `${text}|${color}`;
  let t = textures.get(key);
  if (!t) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!; g.font = 'bold 48px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = stroke; g.strokeText(text, 32, 34); g.fillStyle = color; g.fillText(text, 32, 34);
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; textures.set(key, t);
  }
  return t;
}

interface Posable { object3d: THREE.Object3D; drive(state: AnimationState, nowMs: number, yaw: number): void; height(): number; dispose(): void; ready: boolean }

function rosterEntry(id: string, name: string, look: { sex: 'male' | 'female'; heightCm: number; appearance: any; dominantHand?: 'right' | 'left'; equipment?: any; refinement?: any }): TownRosterEntry {
  return {
    characterId: id, name, level: 1, appearance: look.appearance ?? defaultAppearance(), sex: look.sex, heightCm: look.heightCm, seed: 0, online: true,
    sleeping: null, wakeFrom: null, lastSeenAt: new Date(0).toISOString(), dominantHand: look.dominantHand ?? 'right',
    equipment: look.equipment ?? {}, refinement: look.refinement ?? undefined,
  };
}

/** A dressed character (players, and monsters drawn as characters such as the Bandit). */
class CharacterModel implements Posable {
  readonly character: TownCharacter;
  ready = false;
  constructor(factory: TownCharacterFactory, entry: TownRosterEntry) {
    this.character = new TownCharacter(factory, entry, { arena: true });
    void this.character.ready.then(() => { this.ready = true; }, () => undefined);
  }
  get object3d() { return this.character.object3d; }
  drive(state: AnimationState, nowMs: number, yaw: number) { this.character.drive(state, nowMs, 0, 0, yaw); }
  height() { return ((this.character.entry.heightCm ?? 175) / 100) * 1.02; }
  setEntry(entry: TownRosterEntry) { this.character.setEntry(entry); }
  dispose() { this.character.dispose(); }
}

class MonsterPosable implements Posable {
  readonly object3d = new THREE.Group();
  ready = true;
  private scale = 1;
  constructor(readonly model: MonsterModel) {
    const size = model.nativeSize;
    this.scale = monsterScale(size.width, size.height);
    model.object3d.scale.multiplyScalar(this.scale);
    this.object3d.add(model.object3d);
  }
  drive(state: AnimationState, nowMs: number, yaw: number) {
    this.object3d.rotation.y = yaw;
    this.model.drive(animationStateToMonster(state), state.freezeAtMs !== undefined ? Math.min(nowMs, state.freezeAtMs) : nowMs);
  }
  height() { return this.model.nativeSize.height * this.scale; }
  dispose() { this.model.dispose(); }
}

/** Grey (or team-tinted) capsule: a character without a look, or a model still loading / missing. */
class PlaceholderPosable implements Posable {
  readonly object3d = new THREE.Group();
  ready = true;
  private readonly owned: Array<{ dispose(): void }> = [];
  constructor(color: string) {
    const geometry = new THREE.CapsuleGeometry(0.32, 0.9, 4, 12);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.78;
    this.object3d.add(mesh);
    this.owned.push(geometry, material);
  }
  drive(state: AnimationState, nowMs: number, yaw: number) {
    this.object3d.rotation.y = yaw;
    const t = state.freezeAtMs !== undefined ? Math.min(nowMs, state.freezeAtMs) : nowMs;
    const dead = state.oneShot?.clip === 'Dead';
    this.object3d.rotation.z = dead ? Math.PI / 2 * 0.9 : 0;
    this.object3d.position.y = dead ? 0.1 : Math.abs(Math.sin(t / (state.base === 'Walk' || state.base === 'Sprint' ? 160 : 600))) * 0.06;
  }
  height() { return 1.7; }
  dispose() { for (const o of this.owned) o.dispose(); }
}

export class ArenaActorView {
  /** At the actor's feet; the runtime places it on the grid. */
  readonly object3d = new THREE.Group();
  private posable: Posable;
  private pending: Posable | null = null;
  private readonly shadow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly fx = new THREE.Group();
  private stars: THREE.Sprite[] = [];
  private zs: THREE.Sprite[] = [];
  private ice: THREE.Group | null = null;
  private readonly owned: Array<{ dispose(): void }> = [];
  /** Materials this view cloned for itself (flash and fade never touch shared materials). */
  private readonly ownMaterials = new WeakSet<THREE.Material>();
  private lookKey: string;
  private disposed = false;

  constructor(readonly visual: ArenaActorVisual, private readonly factory: TownCharacterFactory, manifest: Promise<Record<string, MonsterManifestEntry>> = loadMonsterManifest()) {
    this.object3d.name = `arena:${visual.id}`;
    this.lookKey = JSON.stringify(visual.look);
    this.posable = new PlaceholderPosable(visual.team === 'a' ? '#8fa6c8' : '#9a8f86');
    this.object3d.add(this.posable.object3d);

    const shadowGeometry = new THREE.PlaneGeometry(1.4, 1.4);
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false });
    this.shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02; this.shadow.renderOrder = 1;
    const ringGeometry = new THREE.RingGeometry(0.55, 0.78, 40);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: TEAM_RING[visual.team], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringGeometry, ringMaterial);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.04; this.ring.renderOrder = 2;
    this.object3d.add(this.shadow, this.ring, this.fx);
    this.owned.push(shadowGeometry, shadowMaterial, ringGeometry, ringMaterial);

    if (visual.kind === 'character' && visual.look) this.swap(new CharacterModel(factory, rosterEntry(visual.id, visual.name, visual.look)));
    else if (visual.kind !== 'character' && visual.monsterId) void this.loadMonster(visual.monsterId, manifest);
  }

  /** Gear changes between battles: re-dress the walking character. */
  setLook(look: ArenaCharacterLook | null): void {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    if (!look) return;
    const entry = rosterEntry(this.visual.id, this.visual.name, look);
    if (this.posable instanceof CharacterModel) this.posable.setEntry(entry);
    else this.swap(new CharacterModel(this.factory, entry));
  }

  /** Head height above the feet, metres (status effects and the HUD anchor sit there). */
  headHeight(): number { return this.posable.height(); }

  update(frame: ArenaActorFrame, nowMs: number, feedback: ArenaFeedback[]): void {
    if (this.pending?.ready) this.commit();
    const yaw = frame.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.posable.drive(frame.anim, nowMs, yaw);
    const exit = frame.exit ?? 0;
    this.posable.object3d.position.y = (this.posable instanceof PlaceholderPosable ? this.posable.object3d.position.y : 0) - exit * 0.6;
    const head = this.headHeight();

    // Cast ring: pulses while casting.
    const ringMaterial = this.ring.material as THREE.MeshBasicMaterial;
    ringMaterial.opacity = frame.cast ? 0.55 + 0.25 * Math.sin(nowMs / 120) : 0;
    this.ring.scale.setScalar(frame.cast ? 1 + 0.08 * Math.sin(nowMs / 200) : 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - exit;

    this.updateStars(frame.statuses.includes('stun'), head, nowMs);
    this.updateZs(frame.statuses.includes('sleep'), head, nowMs);
    this.updateIce(frame.statuses.includes('freeze'), head);

    // Hit flash: the newest flash on this actor, fading over FLASH_MS.
    const hit = feedback.filter((f) => f.targetId === this.visual.id && f.flash && nowMs - f.atMs < FLASH_MS).pop();
    const strength = hit ? 1 - (nowMs - hit.atMs) / FLASH_MS : 0;
    this.tint(hit?.flash ? FLASH_COLORS[hit.flash] : '#000000', strength, 1 - exit);
  }

  dispose(): void {
    this.disposed = true;
    this.posable.dispose();
    this.pending?.dispose();
    this.ice?.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    for (const s of [...this.stars, ...this.zs]) s.material.dispose();
    for (const o of this.owned) o.dispose();
    this.object3d.removeFromParent();
  }

  private async loadMonster(monsterId: string, manifest: Promise<Record<string, MonsterManifestEntry>>): Promise<void> {
    const entry = (await manifest.catch(() => ({} as Record<string, MonsterManifestEntry>)))[monsterManifestKey(monsterId)];
    if (this.disposed) return;
    if (entry?.rig === 'char' && entry.character) {
      const c = entry.character;
      this.swap(new CharacterModel(this.factory, rosterEntry(this.visual.id, this.visual.name, { sex: c.sex, heightCm: c.heightCm, appearance: c.appearance, equipment: c.equipment })));
      return;
    }
    const model = await MonsterModel.loadOrPlaceholder(monsterId);
    if (this.disposed) { model.dispose(); return; }
    this.swap(new MonsterPosable(model));
  }

  /** Show `next` once it is ready (characters dress asynchronously). */
  private swap(next: Posable): void {
    this.pending?.dispose();
    this.pending = next;
    if (next.ready) this.commit();
  }

  private commit(): void {
    const next = this.pending!;
    this.pending = null;
    this.posable.object3d.removeFromParent();
    this.posable.dispose();
    this.posable = next;
    this.object3d.add(next.object3d);
  }

  /** Emissive tint (hit flash) and opacity (exit) on this view's own material copies. */
  private tint(color: string, strength: number, opacity: number): void {
    const c = new THREE.Color(color).multiplyScalar(strength * 0.55);
    this.posable.object3d.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const own = list.map((m) => {
        if (this.ownMaterials.has(m)) return m;
        const copy = m.clone(); this.ownMaterials.add(copy); this.owned.push(copy); return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? own : own[0];
      for (const m of own) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.emissive) std.emissive.copy(c);
        m.transparent = opacity < 1 || m.userData['wasTransparent'] === true;
        m.opacity = opacity;
      }
    });
  }

  private updateStars(on: boolean, head: number, nowMs: number): void {
    if (on && !this.stars.length) {
      for (let i = 0; i < 5; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyph('★', '#ffe14d', '#7a5200'), depthTest: false })); s.scale.setScalar(0.5); s.renderOrder = 20; this.stars.push(s); this.fx.add(s); }
    }
    this.stars.forEach((s, i) => {
      s.visible = on;
      const a = nowMs / 450 + (i / this.stars.length) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.55, head + 0.25 + Math.sin(a * 2) * 0.05, Math.sin(a) * 0.55);
    });
  }

  private updateZs(on: boolean, head: number, nowMs: number): void {
    if (on && !this.zs.length) {
      for (const [i, text] of ['z', 'Z', 'z'].entries()) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyph(text, '#dfe9ff', '#1b2a55'), transparent: true, depthTest: false })); s.scale.setScalar(0.45 + i * 0.15); s.renderOrder = 20; this.zs.push(s); this.fx.add(s); }
    }
    this.zs.forEach((s, i) => {
      s.visible = on;
      const t = ((nowMs / 1600) + i / 3) % 1;
      s.position.set(0.2 + t * 0.5, head + 0.15 + t * 1.0, 0);
      s.material.opacity = Math.sin(t * Math.PI);
    });
  }

  /** A ~90 % transparent ice-blue crystal block around the body. */
  private updateIce(on: boolean, head: number): void {
    if (on && !this.ice) {
      const w = 1.1, h = head + 0.25;
      const geometry = new THREE.BoxGeometry(w, h, w);
      const block = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.12, roughness: 0.08, metalness: 0, clearcoat: 1, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: '#e8f8ff', transparent: true, opacity: 0.45 }));
      this.ice = new THREE.Group();
      this.ice.add(block, edges);
      this.ice.position.y = h / 2;
      this.ice.renderOrder = 15;
      this.fx.add(this.ice);
    }
    if (this.ice) this.ice.visible = on;
  }
}
