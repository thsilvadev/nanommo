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

export async function createTownRuntime(host: HTMLElement, init: TownSceneRuntimeInit): Promise<TownRuntime> {
  const loader = new GLTFLoader();
  const cache = CharacterAssetCache.shared(init.assetBase, (url) => loader.loadAsync(url));
  const catalog = await loadAppearanceCatalog(init.catalogUrl);
  return new TownRuntime(host, init, new TownCharacterFactory(cache, catalog));
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
  await Promise.allSettled([
    loadAppearanceCatalog(catalogUrl),
    cache.body('male'),
    cache.body('female'),
    cache.animations(),
    cache.glb(NPC_PROPS_ASSET),
    ...[...outfits].map((asset) => cache.glb(asset)),
  ]);
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
  private selfId: string | null;
  private selection: TownPick | null = null;
  private centred = false;
  private frame: number | null = null;
  private lastFrameAt: number | null = null;
  private disposed = false;
  private active = true;

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
        this.npcProps.push(buildNpcVisual(visual, { factory }).then((props) => {
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
    this.world.update(now);
    this.renderNow();
  }

  private startLoop(): void {
    if (this.frame !== null || this.disposed || document.hidden || !this.active) return;
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
