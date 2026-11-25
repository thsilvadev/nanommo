/**
 * The battle arena scene: one WebGLRenderer, the scenery, one view per combatant,
 * flying arrows and hit sparks. It draws what a frame source returns for `now`
 * (the pure projection: arena-phase / arena-actions) and computes nothing about
 * the battle itself. Loaded on demand (three.js stays out of the initial bundle).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { loadAppearanceCatalog } from '../../../shared/character-viewer/appearance-catalog';
import { buildArrow } from '../../../shared/character-viewer/bow-shot';
import { MonsterModel, loadMonsterManifest } from '../../../shared/monster-viewer/monster-model';
import { TownCharacterFactory } from '../town-scene/town-character';
import type { ArenaActorFrame } from './arena-actions';
import { ArenaActorView, type ArenaActorVisual } from './arena-actor-views';
import { ARENA_CAMERA_FOV_DEG, ARENA_CAMERA_PITCH_DEG, cellToWorld, frameCells } from './arena-camera';
import type { ArenaSceneFrame } from './arena-phase';
import type { ArenaRegionId } from './arena-region';
import { ArenaScenery } from './arena-scenery';

export type { ArenaActorVisual } from './arena-actor-views';
export interface ArenaFrameInput { scene: ArenaSceneFrame; visuals: Map<string, ArenaActorVisual>; region: ArenaRegionId }
export type ArenaFrameSource = (nowMs: number) => ArenaFrameInput | null;
export interface ArenaAnchor { x: number; y: number; visible: boolean }

export interface ArenaRuntimeHandle {
  /** What to draw each frame (null: keep the last frame). */
  setSource(source: ArenaFrameSource | null): void;
  /** Head anchor of every drawn actor, CSS px relative to the canvas (HUD bars, names, numbers). */
  screenAnchors(): Map<string, ArenaAnchor>;
  /** Hidden arena: stop the render loop; showing it again resumes it. */
  setActive(active: boolean): void;
  isRendering(): boolean;
  /** Draw one frame now (tests, and the first frame before the loop runs). */
  renderOnce(nowMs: number): void;
  actorCount(): number;
  resize(): void;
  dispose(): void;
}

export interface ArenaRuntimeInit { assetBase: string; catalogUrl?: string; onContextLost: () => void; now?: () => number }

const MAX_PIXEL_RATIO = 1.5;
/** Camera follow time constant (≈ 95 % of the way in 3×). */
const CAMERA_FOLLOW_MS = 260;
const SPARK_MS = 250;
/** The arrow mesh is life-size (0.72 m); from the broadcast camera it needs to read. */
const ARROW_SCALE = 2.2;

export async function createArenaRuntime(host: HTMLElement, init: ArenaRuntimeInit): Promise<ArenaRuntimeHandle> {
  const loader = new GLTFLoader();
  const cache = CharacterAssetCache.shared(init.assetBase, (url) => loader.loadAsync(url));
  const catalog = await loadAppearanceCatalog(init.catalogUrl);
  return new ArenaRuntime(host, init, new TownCharacterFactory(cache, catalog));
}

class ArenaRuntime implements ArenaRuntimeHandle {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(ARENA_CAMERA_FOV_DEG, 16 / 9, 0.5, 400);
  private readonly scenery: ArenaScenery;
  private readonly views = new Map<string, ArenaActorView>();
  private readonly arrows: THREE.Object3D[] = [];
  private readonly sparks: THREE.Sprite[] = [];
  private readonly sparkMaterial: THREE.SpriteMaterial;
  private readonly anchors = new Map<string, ArenaAnchor>();
  private readonly cleanups: Array<() => void> = [];
  private source: ArenaFrameSource | null = null;
  private frame: number | null = null;
  private active = false;
  private disposed = false;
  private lastMs: number | null = null;
  /** Camera framing: follows `target` smoothly; re-aimed per battle, and outwards when someone leaves the frame. */
  private cam = { key: '', at: { x: 0, z: 0, d: 30 }, target: { x: 0, z: 0, d: 30 } };
  private readonly now: () => number;

  constructor(private readonly host: HTMLElement, init: ArenaRuntimeInit, private readonly factory: TownCharacterFactory) {
    this.now = init.now ?? Date.now;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const lost = (event: Event) => { event.preventDefault(); init.onContextLost(); };
    canvas.addEventListener('webglcontextlost', lost);
    this.cleanups.push(() => canvas.removeEventListener('webglcontextlost', lost));
    // Shaders link before a model is first drawn (no stall on the frame it appears).
    factory.prepare = (object) => this.renderer.compileAsync(object, this.camera, this.scene).catch(() => undefined);
    void warmMonsterShaders(factory.prepare, () => this.disposed);

    this.scene.background = new THREE.Color('#9fc8ec');
    this.scene.add(new THREE.HemisphereLight('#fff6e6', '#5a6a3a', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(-8, 16, 12);
    this.scene.add(sun);
    this.scenery = new ArenaScenery(this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.scenery.group);
    this.sparkMaterial = new THREE.SpriteMaterial({ map: sparkTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(host);
    this.cleanups.push(() => resize.disconnect());
    const visibility = () => (document.hidden || !this.active ? this.stopLoop() : this.startLoop());
    document.addEventListener('visibilitychange', visibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', visibility));
    this.resize();
  }

  setSource(source: ArenaFrameSource | null): void { this.source = source; }
  screenAnchors(): Map<string, ArenaAnchor> { return this.anchors; }
  isRendering(): boolean { return this.frame !== null; }
  actorCount(): number { return this.views.size; }

  setActive(active: boolean): void {
    this.active = active;
    if (active && !document.hidden) this.startLoop(); else this.stopLoop();
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  renderOnce(nowMs: number): void {
    if (this.disposed) return;
    const input = this.source?.(nowMs);
    const dt = this.lastMs === null ? 0 : Math.min(250, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;
    if (input) this.apply(input, nowMs, dt);
    this.renderer.render(this.scene, this.camera);
    this.updateAnchors();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    for (const a of this.arrows) a.removeFromParent();
    this.sparkMaterial.dispose();
    this.scenery.dispose();
    for (const c of this.cleanups) c();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private startLoop(): void {
    if (this.frame !== null || this.disposed) return;
    const loop = () => { this.renderOnce(this.now()); this.frame = requestAnimationFrame(loop); };
    this.frame = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private apply(input: ArenaFrameInput, nowMs: number, dtMs: number): void {
    const { scene } = input;
    this.scenery.setRegion(input.region, nowMs);
    this.scenery.update(scene.scroll, dtMs, nowMs);

    // Views: create for new actors, drop the ones that left the frame.
    const seen = new Set<string>();
    for (const actor of scene.frame.actors) {
      const visual = input.visuals.get(actor.id) ?? { id: actor.id, team: 'a', kind: 'character', name: actor.id, look: null, monsterId: null } as ArenaActorVisual;
      let view = this.views.get(actor.id);
      if (!view) { view = new ArenaActorView(visual, this.factory); this.views.set(actor.id, view); this.scene.add(view.object3d); }
      // Gear only changes between battles: the walkers are re-dressed outside battles.
      if (scene.phase !== 'battle' && visual.kind === 'character') view.setLook(visual.look);
      seen.add(actor.id);
      const p = cellToWorld(actor);
      view.object3d.position.set(p.x, 0, p.z);
      view.update(actor, nowMs, scene.frame.feedback);
    }
    for (const [id, view] of this.views) if (!seen.has(id)) { view.dispose(); this.views.delete(id); }

    this.updateArrows(scene.frame.actors, nowMs);
    this.updateSparks(scene, nowMs);
    this.updateCamera(scene, dtMs);
  }

  private updateArrows(actors: ArenaActorFrame[], nowMs: number): void {
    const flying = actors.filter((a) => a.projectile && nowMs >= a.projectile.launchAtMs && nowMs < a.projectile.hitAtMs);
    while (this.arrows.length < flying.length) { const arrow = buildArrow(); arrow.scale.setScalar(ARROW_SCALE); this.arrows.push(arrow); this.scene.add(arrow); }
    this.arrows.forEach((arrow, i) => {
      const shooter = flying[i];
      arrow.visible = !!shooter;
      if (!shooter) return;
      const from = this.views.get(shooter.projectile!.fromId), to = this.views.get(shooter.projectile!.toId);
      if (!from || !to) { arrow.visible = false; return; }
      const f = (nowMs - shooter.projectile!.launchAtMs) / (shooter.projectile!.hitAtMs - shooter.projectile!.launchAtMs);
      const a = from.object3d.position.clone().setY(from.headHeight() * 0.72);
      const b = to.object3d.position.clone().setY(to.aimHeight());
      const pos = a.clone().lerp(b, f);
      pos.y += Math.sin(f * Math.PI) * 0.8;
      const ahead = a.clone().lerp(b, Math.min(1, f + 0.02)); ahead.y += Math.sin(Math.min(1, f + 0.02) * Math.PI) * 0.8;
      arrow.position.copy(pos);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ahead.sub(pos).normalize());
    });
  }

  /** A short white burst on every hit (numbers and the flash come from the same feedback). */
  private updateSparks(scene: ArenaSceneFrame, nowMs: number): void {
    const live = scene.frame.feedback.filter((f) => f.style !== 'heal' && f.style !== 'miss' && nowMs - f.atMs < SPARK_MS);
    while (this.sparks.length < live.length) { const s = new THREE.Sprite(this.sparkMaterial); s.renderOrder = 25; this.sparks.push(s); this.scene.add(s); }
    this.sparks.forEach((spark, i) => {
      const hit = live[i];
      const view = hit ? this.views.get(hit.targetId) : null;
      spark.visible = !!view;
      if (!view || !hit) return;
      const f = (nowMs - hit.atMs) / SPARK_MS;
      spark.position.copy(view.object3d.position).setY(view.aimHeight());
      spark.scale.setScalar(0.4 + f * 1.4);
      spark.material.opacity = 1 - f;
    });
  }

  private updateCamera(scene: ArenaSceneFrame, dtMs: number): void {
    const living = scene.frame.actors.filter((a) => a.deadAtMs === null && !a.fleeing);
    const cells = (living.length ? living : scene.frame.actors).map((a) => ({ row: a.row, column: a.column }));
    const want = frameCells(cells, this.camera.aspect);
    const battle = scene.phase === 'battle' || scene.phase === 'wipe';
    const key = battle ? `battle:${scene.battleId}` : 'walk';
    const first = this.cam.key === '';
    if (key !== this.cam.key || !battle) {
      // Walking, entering, leaving: follow the ideal frame. A new battle: aim at its frame.
      this.cam.target = { x: want.targetX, z: want.targetZ, d: want.distance };
    } else if (want.distance > this.cam.target.d * 1.04) {
      // Someone left the frame during the battle: open up, never close in.
      this.cam.target = { x: want.targetX, z: want.targetZ, d: want.distance };
    }
    this.cam.key = key;
    if (first) this.cam.at = { ...this.cam.target };
    // Critically damped follow: smooth whatever the frame rate.
    const k = 1 - Math.exp(-dtMs / CAMERA_FOLLOW_MS);
    const at = this.cam.at, to = this.cam.target;
    at.x += (to.x - at.x) * k; at.z += (to.z - at.z) * k; at.d += (to.d - at.d) * k;
    const pitch = (ARENA_CAMERA_PITCH_DEG * Math.PI) / 180;
    this.camera.position.set(at.x, at.d * Math.sin(pitch) + 0.9, at.z + at.d * Math.cos(pitch));
    this.camera.lookAt(at.x, 0.9, at.z);
  }

  private updateAnchors(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    this.anchors.clear();
    for (const [id, view] of this.views) {
      v.copy(view.object3d.position).setY(view.headHeight() + 0.35).project(this.camera);
      const visible = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
      this.anchors.set(id, { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible });
    }
  }
}

/**
 * Links every monster's shaders once the arena exists (the files were parsed on the loading screen), one
 * after the other, so the first appearance of a species never stalls a frame. Never throws.
 */
async function warmMonsterShaders(prepare: (object: THREE.Object3D) => Promise<unknown>, stopped: () => boolean): Promise<void> {
  const manifest = await loadMonsterManifest().catch(() => ({} as Awaited<ReturnType<typeof loadMonsterManifest>>));
  for (const [key, entry] of Object.entries(manifest)) {
    if (stopped()) return;
    if (!entry.file || entry.rig === 'char') continue;
    try {
      const model = await MonsterModel.load(`mon_${key}`);
      await prepare(model.object3d);
      model.dispose();
    } catch { /* a missing model shows as a capsule anyway */ }
  }
}

let spark: THREE.CanvasTexture | null = null;
function sparkTexture(): THREE.CanvasTexture {
  if (spark) return spark;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,240,200,0.7)'); grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  spark = new THREE.CanvasTexture(c);
  return spark;
}
