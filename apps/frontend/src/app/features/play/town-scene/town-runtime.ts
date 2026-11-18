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
import type { TownPick, TownSceneRuntimeHandle, TownSceneRuntimeInit } from './town-scene.types';

const MAX_PIXEL_RATIO = 1.5;
/** Farther than this from the camera target, a character animates at 10 Hz and hides its name. */
const LOD_DISTANCE = 45;

export async function createTownRuntime(host: HTMLElement, init: TownSceneRuntimeInit): Promise<TownRuntime> {
  const loader = new GLTFLoader();
  const cache = CharacterAssetCache.shared(init.assetBase, (url) => loader.loadAsync(url));
  const catalog = await loadAppearanceCatalog(init.catalogUrl);
  return new TownRuntime(host, init, new TownCharacterFactory(cache, catalog));
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
  private readonly raycaster = new THREE.Raycaster();
  private readonly frustum = new THREE.Frustum();
  private readonly cleanups: Array<() => void> = [];
  private selfId: string | null;
  private centred = false;
  private frame: number | null = null;
  private lastFrameAt: number | null = null;
  private disposed = false;

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
    this.cam.centerOn(init.def.spawn.x, init.def.spawn.z);
    this.renderer.setSize(w, h, false);

    for (const [npcId, spot] of Object.entries(init.def.npcSpots)) {
      const npc = new TownCharacter(factory, factory.npcEntry(npcId, init.npcNames[npcId] ?? npcId), { npc: true });
      this.npcs.set(npcId, npc);
      this.npcPoses.set(npcId, { x: spot.x, z: spot.z, facing: (spot.facing * Math.PI) / 180, state: 'idle' });
      this.scene.add(npc.object3d);
    }

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(host);
    this.cleanups.push(() => resize.disconnect());
    const visibility = () => (document.hidden ? this.stopLoop() : this.startLoop());
    document.addEventListener('visibilitychange', visibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', visibility));
    this.startLoop();
  }

  // ---- roster ---------------------------------------------------------------

  setCharacters(entries: TownRosterEntry[], selfId: string | null): void {
    if (this.disposed) return;
    this.selfId = selfId;
    const wanted = new Set(entries.map((e) => e.characterId));
    for (const [id, character] of this.characters) {
      if (!wanted.has(id) || character.opts.self !== (id === selfId)) {
        character.dispose();
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
    }
    if (!this.centred && selfId && this.characters.has(selfId)) {
      const pose = this.pose(this.characters.get(selfId)!.entry);
      this.cam.centerOn(pose.x, pose.z);
      this.centred = true;
    }
  }

  /** Resolves when every character and NPC finished loading (tests, first frame). */
  async settled(): Promise<void> {
    await Promise.all([...this.characters.values(), ...this.npcs.values()].map((c) => c.ready));
    this.tick(0);
  }

  activeCount(): number { return this.characters.size; }
  npcCount(): number { return this.npcs.size; }
  animationOf(id: string): string | null { return this.characters.get(id)?.animation() ?? null; }
  deadProgressOf(id: string): number | null { return this.characters.get(id)?.deadProgress() ?? null; }

  // ---- input ----------------------------------------------------------------

  pan(dxPx: number, dyPx: number): void { this.cam.pan(dxPx, dyPx); }
  zoom(factor: number, atPx?: [number, number]): void { this.cam.zoomBy(factor, atPx); }

  /** NPCs win over players; empty ground picks nothing. */
  pick(x: number, y: number): TownPick | null {
    const { w, h } = this.size();
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.cam.camera);
    const targets = [...this.npcs.values(), ...this.characters.values()].map((c) => c.hitObject);
    const hits = this.raycaster.intersectObjects(targets, false).map((hit) => hit.object.userData['pick'] as TownPickInfo);
    return hits.find((p) => p.kind === 'npc') ?? hits[0] ?? null;
  }

  screenPositionOf(kind: TownPick['kind'], id: string): [number, number] | null {
    const character = (kind === 'npc' ? this.npcs : this.characters).get(id);
    if (!character) return null;
    const point = character.hitObject.getWorldPosition(new THREE.Vector3()).project(this.cam.camera);
    const { w, h } = this.size();
    return [((point.x + 1) / 2) * w, ((1 - point.y) / 2) * h];
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
    this.renderNow();
  }

  private startLoop(): void {
    if (this.frame !== null || this.disposed || document.hidden) return;
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
