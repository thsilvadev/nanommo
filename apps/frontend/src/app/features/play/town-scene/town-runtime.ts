/**
 * The town scene itself: one WebGLRenderer, one scene, the world, the camera,
 * NPCs and up to 100 characters animated from the shared deterministic
 * `positionAt` and the server clock. Loaded on demand (three.js stays out of
 * the initial bundle).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TownNav, positionAt, type TownEventVase, type TownPose, type TownRosterEntry } from '@nanommo/shared';
import { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { loadAppearanceCatalog } from '../../../shared/character-viewer/character-viewer.component';
import { TOWN_CAMERA_MIN_DISTANCE, TownCamera } from './town-camera';
import { TownCharacter, TownCharacterFactory, type TownPickInfo } from './town-character';
import { buildTownWorld, type TownWorld } from './town-world';
import { NPC_VISUALS, NPC_PROPS_ASSET, buildNpcVisual, npcAppearance, npcOutfitAsset } from './npc-visuals';
import { VASE_CONTACT_MS, type TownPick, type TownSceneRuntimeHandle, type TownSceneRuntimeInit } from './town-scene.types';
import { TownVases, buildShards } from './town-vases';
import { loadBubbleFont } from './town-speech-bubble';

const MAX_PIXEL_RATIO = 1.5;
/** Farther than this from the camera target, a character animates at 10 Hz and hides its name. */
const LOD_DISTANCE = 45;
/** Below this camera pitch, obstacles between the camera and the characters it looks at are hidden. */
const CLOSE_UP_PITCH_DEG = 40;
/** Spawn / vanish aura around a character entering or leaving the town. */
export const TOWN_AURA_MS = 500;
/** A roster entry that joined less than this long ago still gets the spawn aura when first drawn. */
const JOIN_AURA_WINDOW_MS = 1500;
/** Ground marker where a click-to-move was sent. */
const MARKER_MS = 700;
/** Shards fly and fade for this long after the swing lands. */
const SHATTER_MS = 950;
/** Vases fade out this fast when the event ends. */
const VASE_FADE_MS = 400;
const GRAVITY = 9.8;

let dustTexture: THREE.CanvasTexture | null = null;
let sparkTexture: THREE.CanvasTexture | null = null;

/** Soft round puff (dust) or a bright point (prize sparkle). */
function radialTexture(kind: 'dust' | 'spark'): THREE.CanvasTexture {
  const cached = kind === 'dust' ? dustTexture : sparkTexture;
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === 'dust') { g.addColorStop(0, 'rgba(214,180,140,0.9)'); g.addColorStop(0.6, 'rgba(190,150,110,0.35)'); g.addColorStop(1, 'rgba(180,140,100,0)'); }
  else { g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.25, 'rgba(255,214,90,0.9)'); g.addColorStop(1, 'rgba(255,190,40,0)'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  if (kind === 'dust') dustTexture = texture; else sparkTexture = texture;
  return texture;
}

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
 * bodies with their clips, the appearance catalogue, the NPC outfits and props, the players' gear.
 */
export async function warmTownAssets(assetBase: string, catalogUrl?: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const loader = new GLTFLoader();
  const cache = CharacterAssetCache.shared(assetBase, (url) => loader.loadAsync(url));
  const outfits = new Set<string>();
  for (const visual of Object.values(NPC_VISUALS)) if (visual.figure.kind === 'body' && visual.figure.outfit) outfits.add(npcOutfitAsset(visual.figure.outfit));
  for (const visual of Object.values(NPC_VISUALS)) if (visual.figure.kind === 'model') outfits.add(visual.figure.asset);
  const tasks: Promise<unknown>[] = [
    loadAppearanceCatalog(catalogUrl),
    cache.body('male'),
    cache.body('female'),
    cache.animations(),
    cache.glb(NPC_PROPS_ASSET),
    ...[...outfits].map((asset) => cache.glb(asset)),
    cache.gear(),
  ];
  let done = 0;
  onProgress?.(0, tasks.length);
  for (const task of tasks) void task.then(() => undefined, () => undefined).then(() => onProgress?.(++done, tasks.length));
  const [catalog] = await Promise.allSettled(tasks) as [PromiseSettledResult<Awaited<ReturnType<typeof loadAppearanceCatalog>>>, ...PromiseSettledResult<unknown>[]];
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
  /** World obstacles with their bounds, for the close-up camera to hide what stands in front of it. */
  private obstacleBounds: Array<{ object: THREE.Object3D; box: THREE.Box3 }> | null = null;
  private readonly cleanups: Array<() => void> = [];
  private readonly effects: TownEffect[] = [];
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly vases: TownVases;
  private hasVases = false;
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
    void loadBubbleFont();
    this.scene.add(this.world.group);
    this.scene.fog = this.world.fog;
    this.scene.background = this.world.background;
    this.vases = new TownVases(this.scene);

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

  selectedOf(kind: 'npc' | 'character', id: string): boolean {
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

  /** NPCs win; then the nearest of a vase and a player; empty ground picks nothing. */
  pick(x: number, y: number): TownPick | null {
    const { w, h } = this.size();
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.cam.camera);
    const targets = [...this.npcs.values(), ...this.characters.values()].map((c) => c.hitObject);
    const hits = this.raycaster.intersectObjects(targets, false);
    const infos = hits.map((hit) => hit.object.userData['pick'] as TownPickInfo);
    const npc = infos.find((p) => p.kind === 'npc');
    if (npc) return npc;
    const vaseHit = this.raycaster.intersectObjects(this.vases.pickTargets(), false).find((hit) => this.vases.idOf(hit));
    if (vaseHit && (!hits.length || vaseHit.distance <= hits[0].distance)) return { kind: 'vase', id: this.vases.idOf(vaseHit)! };
    return infos[0] ?? null;
  }

  // ---- Smashing Spree vases ---------------------------------------------------

  setVases(vases: TownEventVase[] | null): void {
    if (this.disposed) return;
    if (vases && vases.length) {
      this.vases.setOpacity(1);
      this.vases.set(vases);
      this.hasVases = true;
      return;
    }
    if (!this.hasVases) return;
    this.hasVases = false;
    this.addEffect(new THREE.Group(), VASE_FADE_MS, (t) => this.vases.setOpacity(1 - t), () => { if (!this.hasVases) this.vases.set(null); });
  }

  setHoveredVase(vaseId: string | null): void { this.vases.setHovered(vaseId); }

  say(characterId: string, text: string): void {
    // The first bubble waits for its font (loaded once, page-wide); later ones draw at once.
    void loadBubbleFont().then(() => { if (!this.disposed) this.characters.get(characterId)?.say(text); });
  }

  /** Text of the speech bubble over a character, or null (tests). */
  speechOf(characterId: string): string | null { return this.characters.get(characterId)?.speech() ?? null; }

  /** On-screen height (px) of a character's speech bubble, or null (tests). */
  speechScreenHeightOf(characterId: string): number | null {
    const sprite = this.characters.get(characterId)?.object3d.getObjectByName('speech-bubble');
    if (!sprite) return null;
    sprite.updateMatrixWorld(true);
    const base = sprite.getWorldPosition(new THREE.Vector3());
    const top = base.clone().setY(base.y + sprite.scale.y);
    const { h } = this.size();
    return Math.abs(base.project(this.cam.camera).y - top.project(this.cam.camera).y) / 2 * h;
  }

  breakVase(vaseId: string, byCharacterId: string, prize: boolean): [number, number] | null {
    if (this.disposed) return null;
    const at = this.vases.positionOf(vaseId);
    if (!at) return null;
    this.vases.hide(vaseId);
    this.characters.get(byCharacterId)?.playOnce('Attack', at);
    this.shatter(vaseId, at, prize);
    return at;
  }

  selfPosition(): [number, number] | null {
    const self = this.selfId ? this.characters.get(this.selfId) : undefined;
    if (!self) return null;
    const pose = this.pose(self.entry);
    return [pose.x, pose.z];
  }

  /**
   * The vase stays whole until the swing lands (VASE_CONTACT_MS), then: clay shards
   * fly out, bounce once and fade, a dust puff rises, and a prize vase sparkles gold.
   */
  private shatter(vaseId: string, at: [number, number], prize: boolean): void {
    const group = new THREE.Group();
    group.name = 'vase-shatter';
    group.position.set(at[0], 0, at[1]);
    group.rotation.y = this.vases.rotationOf(vaseId);
    group.visible = false;
    const shardMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, transparent: true });
    const shards = buildShards(vaseId, this.vases.variantOf(vaseId), shardMaterial);
    for (const shard of shards) group.add(shard.mesh);
    const dustMaterial = new THREE.SpriteMaterial({ map: radialTexture('dust'), transparent: true, depthWrite: false, opacity: 0 });
    const dust = Array.from({ length: 8 }, (_, i) => {
      const sprite = new THREE.Sprite(dustMaterial);
      const a = (i / 8) * Math.PI * 2;
      sprite.position.set(Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15);
      group.add(sprite);
      return { sprite, dir: new THREE.Vector3(Math.cos(a), 0.45 + (i % 3) * 0.15, Math.sin(a)) };
    });
    // Fine clay chips: one Points cloud, a burst faster and lower than the shards.
    const chipCount = 36;
    const chipBase = new Float32Array(chipCount * 6); // start xyz + velocity xyz
    for (let i = 0; i < chipCount; i++) {
      const a = (i / chipCount) * Math.PI * 2 + (i % 5) * 0.21;
      const speed = 1.6 + (i % 7) * 0.32;
      chipBase.set([Math.cos(a) * 0.18, 0.12 + (i % 4) * 0.12, Math.sin(a) * 0.18, Math.cos(a) * speed, 1.2 + (i % 5) * 0.55, Math.sin(a) * speed], i * 6);
    }
    const chipGeometry = new THREE.BufferGeometry();
    chipGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(chipCount * 3), 3));
    const chipMaterial = new THREE.PointsMaterial({ color: '#a2481f', size: 0.07, transparent: true, depthWrite: false });
    const chips = new THREE.Points(chipGeometry, chipMaterial);
    chips.frustumCulled = false;
    group.add(chips);
    // Impact ring on the ground.
    markerGeometry ??= new THREE.RingGeometry(0.28, 0.4, 28);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: prize ? '#ffd76a' : '#f2c79a', transparent: true, opacity: 0, depthWrite: false, fog: false });
    const ring = new THREE.Mesh(markerGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);
    let spark: THREE.Points | null = null;
    let sparkMaterial: THREE.PointsMaterial | null = null;
    let sparkBase: Float32Array | null = null;
    if (prize) {
      const n = 40;
      sparkBase = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 * 3;
        const r = 0.08 + (i % 5) * 0.07;
        sparkBase.set([Math.cos(a) * r, 0.15 + (i % 8) * 0.09, Math.sin(a) * r], i * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(sparkBase.slice(), 3));
      sparkMaterial = new THREE.PointsMaterial({ map: radialTexture('spark'), size: 0.34, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffd76a', fog: false });
      spark = new THREE.Points(geometry, sparkMaterial);
      group.add(spark);
    }
    const total = VASE_CONTACT_MS + SHATTER_MS;
    let landed = false;
    const p = new THREE.Vector3();
    this.addEffect(group, total, (t) => {
      const elapsed = t * total;
      if (elapsed < VASE_CONTACT_MS) return;
      if (!landed) { landed = true; group.visible = true; this.vases.hideInstance(vaseId); }
      const s = (elapsed - VASE_CONTACT_MS) / 1000;
      const k = s / (SHATTER_MS / 1000);
      for (const shard of shards) {
        const { start, velocity, spin } = shard;
        // Ballistic until it meets the ground, then one damped bounce.
        const tHit = (velocity.y + Math.sqrt(velocity.y * velocity.y + 2 * GRAVITY * start.y)) / GRAVITY;
        if (s < tHit) {
          p.set(start.x + velocity.x * s, start.y + velocity.y * s - 0.5 * GRAVITY * s * s, start.z + velocity.z * s);
        } else {
          const s2 = s - tHit;
          const vy = (GRAVITY * tHit - velocity.y) * 0.32;
          p.set(start.x + velocity.x * (tHit + s2 * 0.45), Math.max(0.01, vy * s2 - 0.5 * GRAVITY * s2 * s2), start.z + velocity.z * (tHit + s2 * 0.45));
        }
        shard.mesh.position.copy(p);
        const turn = Math.min(s, tHit + 0.15);
        shard.mesh.rotation.set(spin.x * turn, spin.y * turn, spin.z * turn);
      }
      shardMaterial.opacity = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
      const d = Math.min(1, s / 0.6);
      dustMaterial.opacity = 0.8 * Math.sin(Math.PI * d);
      for (const puff of dust) {
        const spread = 0.15 + 0.6 * (1 - (1 - d) * (1 - d));
        puff.sprite.position.set(puff.dir.x * spread, 0.2 + puff.dir.y * d * 0.8, puff.dir.z * spread);
        puff.sprite.scale.setScalar(0.45 + 0.75 * d);
      }
      const chipPositions = chipGeometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < chipCount; i++) {
        const o = i * 6;
        chipPositions.setXYZ(i, chipBase[o] + chipBase[o + 3] * s, Math.max(0.02, chipBase[o + 1] + chipBase[o + 4] * s - 0.5 * GRAVITY * s * s), chipBase[o + 2] + chipBase[o + 5] * s);
      }
      chipPositions.needsUpdate = true;
      chipMaterial.opacity = Math.max(0, 1 - k * 1.2);
      const r = Math.min(1, s / 0.35);
      ring.scale.setScalar(1 + 2.6 * r);
      ringMaterial.opacity = 0.75 * (1 - r);
      if (spark && sparkMaterial && sparkBase) {
        const positions = spark.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
          positions.setXYZ(i, sparkBase[i * 3] * (1 + k * 1.6), sparkBase[i * 3 + 1] + k * 0.9, sparkBase[i * 3 + 2] * (1 + k * 1.6));
        }
        positions.needsUpdate = true;
        sparkMaterial.opacity = Math.sin(Math.PI * Math.min(1, k * 1.1));
      }
    }, () => {
      for (const shard of shards) shard.mesh.geometry.dispose();
      shardMaterial.dispose();
      dustMaterial.dispose();
      chipGeometry.dispose();
      chipMaterial.dispose();
      ringMaterial.dispose();
      spark?.geometry.dispose();
      sparkMaterial?.dispose();
    });
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

  screenPositionOf(kind: 'npc' | 'character', id: string): [number, number] | null {
    const character = (kind === 'npc' ? this.npcs : this.characters).get(id);
    if (!character) return null;
    const point = character.hitObject.getWorldPosition(new THREE.Vector3()).project(this.cam.camera);
    const { w, h } = this.size();
    return [((point.x + 1) / 2) * w, ((1 - point.y) / 2) * h];
  }

  /** Vertical extent of a character's click box in world units (tests: elevated NPCs). */
  hitBoxOf(kind: 'npc' | 'character', id: string): { minY: number; maxY: number } | null {
    const character = (kind === 'npc' ? this.npcs : this.characters).get(id);
    if (!character) return null;
    character.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(character.hitObject);
    return { minY: box.min.y, maxY: box.max.y };
  }

  worldPositionOf(kind: 'npc' | 'character', id: string): [number, number] | null {
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
    this.vases.dispose();
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
    this.cam.step(dtMs);
    const camera = this.cam.camera;
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.applyCloseUp();
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

  /**
   * Close-up camera: name plates shrink with the distance (keeping their
   * closest top-down screen size), and obstacles wholly between the camera
   * and the characters it looks at are hidden, so a house or a tree crown
   * never fills the frame.
   */
  private applyCloseUp(): void {
    // Every frame (a no-op when unchanged): characters that joined since get it too.
    const plateScale = Math.min(1, this.cam.viewDistance / TOWN_CAMERA_MIN_DISTANCE);
    // Speech bubbles keep one size on screen at every zoom (zooming out never makes them unreadable).
    const bubbleScale = this.cam.viewDistance / TOWN_CAMERA_MIN_DISTANCE;
    for (const character of this.characters.values()) { character.setPlateScale(plateScale); character.setBubbleScale(bubbleScale); }
    for (const npc of this.npcs.values()) npc.setPlateScale(plateScale);
    const closeUp = this.cam.pitchDeg < CLOSE_UP_PITCH_DEG;
    if (!closeUp && !this.obstacleBounds) return;
    this.obstacleBounds ??= this.world.group.children
      .filter((o) => o.name.startsWith('obstacle:'))
      .map((object) => ({ object, box: new THREE.Box3().setFromObject(object) }));
    const camera = this.cam.camera;
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const focusDepth = this.cam.viewDistance - 0.6;
    const corner = new THREE.Vector3();
    for (const { object, box } of this.obstacleBounds) {
      let hide = false;
      if (closeUp && (box.containsPoint(camera.position) || this.frustum.intersectsBox(box))) {
        // Farthest corner along the view: in front of the characters if it is closer than they are.
        let far = -Infinity;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
          far = Math.max(far, corner.sub(camera.position).dot(forward));
        }
        hide = far < focusDepth || box.containsPoint(camera.position);
      }
      object.visible = !hide;
    }
    if (!closeUp) this.obstacleBounds = null;
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
