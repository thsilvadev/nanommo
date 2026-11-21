/**
 * The town scene itself: one WebGLRenderer, one scene, the world, the camera,
 * NPCs and up to 100 characters animated from the shared deterministic
 * `positionAt` and the server clock. Loaded on demand (three.js stays out of
 * the initial bundle).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TownNav, positionAt, type TownPose, type TownRosterEntry } from '@nanommo/shared';
import { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { loadAppearanceCatalog } from '../../../shared/character-viewer/character-viewer.component';
import { TownCamera } from './town-camera';
import { TownCharacter, TownCharacterFactory, type TownPickInfo } from './town-character';
import { buildTownWorld, type TownWorld } from './town-world';
import { NPC_VISUALS, NPC_PROPS_ASSET, buildNpcVisual, npcAppearance, npcOutfitAsset } from './npc-visuals';
import type { TownPick, TownSceneRuntimeHandle, TownSceneRuntimeInit } from './town-scene.types';

const MAX_PIXEL_RATIO = 1.5;
/** Farther than this from the camera target, a character animates at 10 Hz and hides its name. */
const LOD_DISTANCE = 45;
/** Spawn / vanish aura around a character entering or leaving the town. */
export const TOWN_AURA_MS = 500;
/** A roster entry that joined less than this long ago still gets the spawn aura when first drawn. */
const JOIN_AURA_WINDOW_MS = 1500;
/** Ground marker where a click-to-move was sent. */
const MARKER_MS = 700;

interface TownEffect { object: THREE.Object3D; startedAt: number; durationMs: number; step: (t: number) => void; done?: () => void }

let auraGeometry: THREE.CylinderGeometry | null = null;
let auraTexture: THREE.CanvasTexture | null = null;
let markerGeometry: THREE.RingGeometry | null = null;

/** Vertical gradient (bright at the feet, gone at the top) for the aura column. */
function auraGradient(): THREE.CanvasTexture {
  if (auraTexture) return auraTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  auraTexture = new THREE.CanvasTexture(canvas);
  return auraTexture;
}

export async function createTownRuntime(host: HTMLElement, init: TownSceneRuntimeInit): Promise<TownRuntime> {
  const loader = new GLTFLoader();
  const cache = CharacterAssetCache.shared(init.assetBase, (url) => loader.loadAsync(url));
  const catalog = await loadAppearanceCatalog(init.catalogUrl);
  const runtime = new TownRuntime(host, init, new TownCharacterFactory(cache, catalog));
  await runtime.warmUp();
  return runtime;
}

/** Resolves when the browser is idle (or after `timeout` ms), to spread warm-up work. */
function whenIdle(timeout = 1500): Promise<void> {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  return new Promise((resolve) => (idle ? idle(() => resolve(), { timeout }) : setTimeout(resolve, 0)));
}

/**
 * Loads (and keeps in the shared asset cache) what every town needs: both
 * bodies with their clips, the appearance catalogue, the NPC outfits and props.
 */
export async function warmTownAssets(assetBase: string, catalogUrl?: string): Promise<void> {
  const loader = new GLTFLoader();
  const cache = CharacterAssetCache.shared(assetBase, (url) => loader.loadAsync(url));
  const outfits = new Set<string>();
  for (const visual of Object.values(NPC_VISUALS)) if (visual.figure.kind === 'body' && visual.figure.outfit) outfits.add(npcOutfitAsset(visual.figure.outfit));
  const [catalog] = await Promise.allSettled([
    loadAppearanceCatalog(catalogUrl),
    cache.body('male'),
    cache.body('female'),
    cache.animations(),
    cache.glb(NPC_PROPS_ASSET),
    ...[...outfits].map((asset) => cache.glb(asset)),
  ]);
  // Recolouring the NPC outfits took ~160 ms on the main thread the moment a town opened:
  // do it now, one NPC per idle slot, into the page-wide cache the town scene reads.
  if (catalog.status !== 'fulfilled') return;
  const factory = new TownCharacterFactory(cache, catalog.value);
  for (const visual of Object.values(NPC_VISUALS)) {
    if (visual.figure.kind !== 'body' || !visual.figure.outfit) continue;
    await whenIdle();
    await factory.warmOutfit(visual.figure).catch(() => undefined);
  }
}

export class TownRuntime implements TownSceneRuntimeHandle {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly world: TownWorld;
  private readonly cam: TownCamera;
  private readonly nav: TownNav;
  private readonly characters = new Map<string, TownCharacter>();
  private readonly npcs = new Map<string, TownCharacter>();
  private readonly npcPoses = new Map<string, TownPose>();
  private readonly npcProps: Promise<void>[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly frustum = new THREE.Frustum();
  private readonly cleanups: Array<() => void> = [];
  private readonly effects: TownEffect[] = [];
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** False until the first roster is drawn: who is already there when the scene opens gets no aura. */
  private populated = false;
  private selfId: string | null;
  private selection: TownPick | null = null;
  private centred = false;
  private frame: number | null = null;
  private lastFrameAt: number | null = null;
  private disposed = false;
  private active = true;
  /** The render loop waits for the world's shaders (warmUp). */
  private started = false;

  constructor(private readonly host: HTMLElement, private readonly init: TownSceneRuntimeInit, private readonly factory: TownCharacterFactory) {
    this.selfId = init.selfId;
    this.nav = new TownNav(init.def);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    this.world = buildTownWorld(init.def);
    this.scene.add(this.world.group);
    this.scene.fog = this.world.fog;
    this.scene.background = this.world.background;

    const { w, h } = this.size();
    this.cam = new TownCamera(w, h, init.def);
    // Shaders link off the frame: objects are compiled (KHR_parallel_shader_compile when
    // available) before they are first drawn, instead of stalling the frame they appear in.
    factory.prepare = (object) => this.renderer.compileAsync(object, this.cam.camera, this.scene).catch(() => undefined);
    this.cam.centerOn(init.def.spawn.x, init.def.spawn.z);
    this.renderer.setSize(w, h, false);

    for (const [npcId, spot] of Object.entries(init.def.npcSpots)) {
      const visual = NPC_VISUALS[npcId];
      const entry = factory.npcEntry(npcId, init.npcNames[npcId] ?? npcId);
      if (visual?.figure.kind === 'body') {
        entry.sex = visual.figure.sex;
        entry.heightCm = visual.figure.heightCm;
        entry.appearance = npcAppearance(factory.npcEntry(npcId, '').appearance!, visual.figure);
      }
      const npc = new TownCharacter(factory, entry, { npc: true, visual: visual?.figure });
      npc.elevation = spot.y ?? 0;
      if (visual) {
        this.npcProps.push(buildNpcVisual(visual, { factory }).then(async (props) => {
          await factory.prepare?.(props);
          if (this.disposed) return;
          props.position.set(spot.x, spot.y ?? 0, spot.z);
          props.rotation.y = (spot.facing * Math.PI) / 180;
          this.scene.add(props);
        }));
      }
      npc.object3d.position.set(spot.x, npc.elevation, spot.z);
      this.npcs.set(npcId, npc);
      this.npcPoses.set(npcId, { x: spot.x, z: spot.z, facing: (spot.facing * Math.PI) / 180, state: 'idle' });
      this.scene.add(npc.object3d);
    }

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(host);
    this.cleanups.push(() => resize.disconnect());
    const visibility = () => (document.hidden || !this.active ? this.stopLoop() : this.startLoop());
    document.addEventListener('visibilitychange', visibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', visibility));
  }

  /** Compiles the town's own shaders, then starts the render loop (first frame without a stall). */
  async warmUp(): Promise<void> {
    await this.factory.prepare?.(this.scene);
    this.started = true;
    this.startLoop();
  }

  // ---- roster ---------------------------------------------------------------

  setCharacters(entries: TownRosterEntry[], selfId: string | null): void {
    if (this.disposed) return;
    this.selfId = selfId;
    const wanted = new Set(entries.map((e) => e.characterId));
    // Everyone gone at once is the scene closing (left town), not people leaving: no auras then.
    const leaving = entries.length > 0;
    for (const [id, character] of this.characters) {
      if (!wanted.has(id) || character.opts.self !== (id === selfId)) {
        if (!wanted.has(id) && leaving && this.active) this.vanish(character);
        else character.dispose();
        this.characters.delete(id);
      }
    }
    for (const entry of entries) {
      const existing = this.characters.get(entry.characterId);
      if (existing && existing.entry.sex === entry.sex && JSON.stringify(existing.entry.appearance) === JSON.stringify(entry.appearance)) {
        existing.setEntry(entry);
        continue;
      }
      existing?.dispose();
      const character = new TownCharacter(this.factory, entry, { self: entry.characterId === selfId });
      this.characters.set(entry.characterId, character);
      this.scene.add(character.object3d);
      const now = this.init.now();
      const justJoined = entry.joinedAt != null && now - entry.joinedAt < JOIN_AURA_WINDOW_MS;
      if (!existing && (this.populated || justJoined)) {
        const pose = this.pose(entry);
        this.aura(pose.x, pose.z, character.opts.self ? '#ffd36a' : '#9fd8ff');
      }
    }
    if (entries.length > 0) this.populated = true;
    this.applySelection();
    if (!this.centred && selfId && this.characters.has(selfId)) {
      const pose = this.pose(this.characters.get(selfId)!.entry);
      this.cam.centerOn(pose.x, pose.z);
      this.centred = true;
    }
  }

  /** Resolves when every character and NPC finished loading (tests, first frame). */
  async settled(): Promise<void> {
    await Promise.all([...[...this.characters.values(), ...this.npcs.values()].map((c) => c.ready), ...this.npcProps]);
    this.tick(0);
  }

  setActive(active: boolean): void {
    if (this.active === active || this.disposed) return;
    this.active = active;
    if (active) { this.resize(); this.startLoop(); } else this.stopLoop();
  }

  isActive(): boolean { return this.active && this.frame !== null; }

  /** Blue ring under one player or NPC (null clears it). */
  setSelection(target: TownPick | null): void {
    this.selection = target;
    this.applySelection();
  }

  selectedOf(kind: TownPick['kind'], id: string): boolean {
    return (kind === 'npc' ? this.npcs : this.characters).get(id)?.isSelected() ?? false;
  }

  private applySelection(): void {
    const sel = this.selection;
    for (const [id, c] of this.characters) c.setSelected(sel?.kind === 'character' && sel.id === id);
    for (const [id, c] of this.npcs) c.setSelected(sel?.kind === 'npc' && sel.id === id);
  }

  /** Farthest horizontal distance of any mesh of an NPC from where it stands (tests: costume pieces stay on the body). */
  npcSpreadOf(id: string): number | null {
    const npc = this.npcs.get(id);
    if (!npc) return null;
    npc.object3d.updateMatrixWorld(true);
    const at = npc.object3d.getWorldPosition(new THREE.Vector3());
    let spread = 0;
    const p = new THREE.Vector3();
    npc.object3d.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) { o.getWorldPosition(p); spread = Math.max(spread, Math.hypot(p.x - at.x, p.z - at.z)); } });
    return spread;
  }

  activeCount(): number { return this.characters.size; }
  npcCount(): number { return this.npcs.size; }
  npcDressed(id: string): boolean { return this.npcs.get(id)?.dressed() ?? false; }
  animationOf(id: string): string | null { return this.characters.get(id)?.animation() ?? null; }
  deadProgressOf(id: string): number | null { return this.characters.get(id)?.deadProgress() ?? null; }
  stoolShownFor(id: string): boolean { return this.characters.get(id)?.stoolShown() ?? false; }

  // ---- input ----------------------------------------------------------------

  pan(dxPx: number, dyPx: number): void { this.cam.pan(dxPx, dyPx); }
  centerOn(x: number, z: number): void { this.cam.centerOn(x, z); }
  zoom(factor: number, atPx?: [number, number]): void { this.cam.zoomBy(factor, atPx); }

  /** NPCs win over players; empty ground picks nothing. */
  pick(x: number, y: number): TownPick | null {
    const { w, h } = this.size();
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.cam.camera);
    const targets = [...this.npcs.values(), ...this.characters.values()].map((c) => c.hitObject);
    const hits = this.raycaster.intersectObjects(targets, false).map((hit) => hit.object.userData['pick'] as TownPickInfo);
    return hits.find((p) => p.kind === 'npc') ?? hits[0] ?? null;
  }

  /** Ground point (world x, z) under a pixel of the scene element, or null off the town. */
  groundPoint(x: number, y: number): [number, number] | null {
    const { w, h } = this.size();
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.cam.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!hit || hit.x < 0 || hit.z < 0 || hit.x > this.init.def.size.w || hit.z > this.init.def.size.h) return null;
    return [hit.x, hit.z];
  }

  /** Short ring on the ground where a click-to-move was sent (local feedback; the server decides the walk). */
  markDestination(x: number, z: number): void {
    if (this.disposed) return;
    markerGeometry ??= new THREE.RingGeometry(0.28, 0.4, 28);
    const material = new THREE.MeshBasicMaterial({ color: '#ffe7a0', transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    const ring = new THREE.Mesh(markerGeometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.04, z);
    ring.name = 'move-marker';
    this.addEffect(ring, MARKER_MS, (t) => {
      ring.scale.setScalar(1.4 - 0.6 * t);
      material.opacity = 0.9 * (1 - t);
    }, () => material.dispose());
  }

  /** Effects still playing (tests). */
  effectCount(): number { return this.effects.length; }

  screenPositionOf(kind: TownPick['kind'], id: string): [number, number] | null {
    const character = (kind === 'npc' ? this.npcs : this.characters).get(id);
    if (!character) return null;
    const point = character.hitObject.getWorldPosition(new THREE.Vector3()).project(this.cam.camera);
    const { w, h } = this.size();
    return [((point.x + 1) / 2) * w, ((1 - point.y) / 2) * h];
  }

  /** Vertical extent of a character's click box in world units (tests: elevated NPCs). */
  hitBoxOf(kind: TownPick['kind'], id: string): { minY: number; maxY: number } | null {
    const character = (kind === 'npc' ? this.npcs : this.characters).get(id);
    if (!character) return null;
    character.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(character.hitObject);
    return { minY: box.min.y, maxY: box.max.y };
  }

  worldPositionOf(kind: TownPick['kind'], id: string): [number, number] | null {
    const character = (kind === 'npc' ? this.npcs : this.characters).get(id);
    return character ? [character.object3d.position.x, character.object3d.position.z] : null;
  }

  resize(): void {
    if (this.disposed) return;
    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);
    this.cam.resize(w, h);
    this.renderNow();
  }

  renderNow(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.cam.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const effect of this.effects.splice(0)) { effect.object.removeFromParent(); effect.done?.(); }
    for (const character of [...this.characters.values(), ...this.npcs.values()]) character.dispose();
    this.characters.clear();
    this.npcs.clear();
    this.factory.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---- loop -----------------------------------------------------------------

  private pose(entry: TownRosterEntry): TownPose {
    return positionAt(this.init.def, this.nav, entry, this.init.now());
  }

  /**
   * Aura: a glowing column and a ring that widens from the feet, TOWN_AURA_MS
   * long. Purely visual and local: every client plays it when the roster says
   * someone arrived or left.
   */
  private aura(x: number, z: number, color: string): void {
    auraGeometry ??= new THREE.CylinderGeometry(0.75, 0.75, 2.6, 24, 1, true);
    markerGeometry ??= new THREE.RingGeometry(0.28, 0.4, 28);
    const column = new THREE.MeshBasicMaterial({
      color, map: auraGradient(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const group = new THREE.Group();
    group.name = 'aura';
    const cylinder = new THREE.Mesh(auraGeometry, column);
    cylinder.position.y = 1.3;
    const ring = new THREE.Mesh(markerGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(cylinder, ring);
    group.position.set(x, 0, z);
    this.addEffect(group, TOWN_AURA_MS, (t) => {
      const fade = Math.sin(Math.PI * t); // in and out
      column.opacity = 0.85 * fade;
      cylinder.scale.set(1 - 0.35 * t, 0.6 + 0.6 * t, 1 - 0.35 * t);
      cylinder.rotation.y = t * 2;
      ringMaterial.opacity = 0.9 * (1 - t);
      ring.scale.setScalar(1 + 3 * t);
    }, () => { column.dispose(); ringMaterial.dispose(); });
  }

  /** A character that left: aura where it stood, and it disappears halfway through it. */
  private vanish(character: TownCharacter): void {
    const at = character.object3d.position;
    this.aura(at.x, at.z, '#9fd8ff');
    this.addEffect(new THREE.Group(), TOWN_AURA_MS / 2, () => undefined, () => character.dispose());
  }

  private addEffect(object: THREE.Object3D, durationMs: number, step: (t: number) => void, done?: () => void): void {
    this.scene.add(object);
    step(0);
    this.effects.push({ object, startedAt: performance.now(), durationMs, step, done });
  }

  private updateEffects(): void {
    const now = performance.now();
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      const t = Math.min(1, (now - effect.startedAt) / effect.durationMs);
      effect.step(t);
      if (t >= 1) {
        effect.object.removeFromParent();
        effect.done?.();
        this.effects.splice(i, 1);
      }
    }
  }

  private tick(dtMs: number): void {
    const camera = this.cam.camera;
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const target = this.cam.target;
    const lodOf = (x: number, z: number) => {
      const near = Math.hypot(x - target.x, z - target.z) <= LOD_DISTANCE;
      return near && this.frustum.containsPoint(new THREE.Vector3(x, 1, z)) ? 'full' : 'low';
    };
    const now = this.init.now();
    for (const character of this.characters.values()) {
      const pose = positionAt(this.init.def, this.nav, character.entry, now);
      character.update(pose, dtMs, lodOf(pose.x, pose.z), now);
    }
    for (const [id, npc] of this.npcs) {
      const pose = this.npcPoses.get(id)!;
      npc.update(pose, dtMs, lodOf(pose.x, pose.z), now);
    }
    this.world.update(now);
    this.updateEffects();
    this.renderNow();
  }

  private startLoop(): void {
    if (!this.started || this.frame !== null || this.disposed || document.hidden || !this.active) return;
    const step = (at: number) => {
      this.frame = requestAnimationFrame(step);
      const dt = this.lastFrameAt === null ? 0 : Math.min(250, at - this.lastFrameAt);
      this.lastFrameAt = at;
      this.tick(dt);
    };
    this.frame = requestAnimationFrame(step);
  }

  private stopLoop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastFrameAt = null;
  }

  private size(): { w: number; h: number } {
    return { w: Math.max(1, this.host.clientWidth), h: Math.max(1, this.host.clientHeight) };
  }
}
