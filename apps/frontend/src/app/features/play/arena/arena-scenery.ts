/**
 * The arena backdrop: a tiling ground plane and three painted layers (sky, far,
 * near) behind the grid, each scrolled at its own speed while the party walks —
 * the characters stand still, the world slides left. Changing region crossfades
 * the layers.
 */
import * as THREE from 'three';
import { arenaRegionAssets, type ArenaRegionId } from './arena-region';

/** Walking pace of the ground, metres per second. */
export const ARENA_WALK_SPEED_M_S = 1.4;
const CROSSFADE_MS = 600;
/** Ground tile size in metres (one 512 px texture). */
const GROUND_TILE_M = 7;

interface LayerSpec { key: 'sky' | 'far' | 'near'; z: number; width: number; height: number; bottom: number; repeat: number; speed: number; transparent: boolean }
/** Every layer image is 4:1; width / repeat / height keeps that ratio. Speeds are fractions of the ground speed. */
const LAYERS: LayerSpec[] = [
  { key: 'sky', z: -120, width: 560, height: 140, bottom: -20, repeat: 1, speed: 0.04, transparent: false },
  { key: 'far', z: -70, width: 168, height: 42, bottom: -9, repeat: 1, speed: 0.22, transparent: true },
  { key: 'near', z: -22, width: 120, height: 15, bottom: -1.2, repeat: 2, speed: 0.6, transparent: true },
];

interface LayerSet { region: ArenaRegionId; group: THREE.Group; materials: THREE.MeshBasicMaterial[]; textures: THREE.Texture[]; layers: Array<{ spec: LayerSpec; texture: THREE.Texture }>; ground: THREE.Texture; groundMaterial: THREE.MeshLambertMaterial; bornAt: number }

export class ArenaScenery {
  readonly group = new THREE.Group();
  private readonly loader = new THREE.TextureLoader();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private current: LayerSet | null = null;
  private leaving: LayerSet | null = null;
  private wanted: ArenaRegionId | null = null;
  /** Metres walked so far (drives every layer's texture offset). */
  private walked = 0;

  constructor(private readonly maxAnisotropy: number) {
    this.group.name = 'arena:scenery';
  }

  setRegion(region: ArenaRegionId, nowMs: number): void {
    if (this.wanted === region) return;
    this.wanted = region;
    const set = this.build(region, nowMs);
    if (this.leaving) this.dispose(this.leaving);
    this.leaving = this.current;
    this.current = set;
    this.group.add(set.group);
  }

  /** Advance the scroll by `dtMs` at `scroll` (0..1 of the walk speed) and settle a crossfade. */
  update(scroll: number, dtMs: number, nowMs: number): void {
    this.walked += ARENA_WALK_SPEED_M_S * scroll * (dtMs / 1000);
    for (const set of [this.current, this.leaving]) {
      if (!set) continue;
      for (const { spec, texture } of set.layers) texture.offset.x = ((this.walked * spec.speed) / (spec.width / spec.repeat)) % 1;
      set.ground.offset.x = (this.walked / GROUND_TILE_M) % 1;
    }
    if (this.current) {
      const f = this.leaving ? Math.min(1, (nowMs - this.current.bornAt) / CROSSFADE_MS) : 1;
      for (const m of this.current.materials) m.opacity = f;
      this.current.groundMaterial.opacity = f;
      if (this.leaving && f >= 1) { this.dispose(this.leaving); this.leaving = null; }
    }
  }

  dispose(set?: LayerSet): void {
    if (set) {
      set.group.removeFromParent();
      for (const m of set.materials) m.dispose();
      set.groundMaterial.dispose();
      for (const t of set.textures) t.dispose();
      return;
    }
    if (this.current) this.dispose(this.current);
    if (this.leaving) this.dispose(this.leaving);
    this.current = this.leaving = null;
    for (const g of this.geometries) g.dispose();
  }

  private texture(url: string, repeatX: number, repeatY = 1): THREE.Texture {
    const texture = this.loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = repeatY > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = this.maxAnisotropy;
    return texture;
  }

  private build(region: ArenaRegionId, nowMs: number): LayerSet {
    const assets = arenaRegionAssets(region);
    const group = new THREE.Group();
    group.name = `arena:scenery:${region}`;
    const set: LayerSet = { region, group, materials: [], textures: [], layers: [], ground: null!, groundMaterial: null!, bornAt: nowMs };
    // Painted layers: unlit, behind everything, never write depth (the grid draws over them).
    for (const spec of LAYERS) {
      const texture = this.texture(assets[spec.key], spec.repeat);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: this.current ? 0 : 1, depthWrite: false, fog: false });
      const geometry = new THREE.PlaneGeometry(spec.width, spec.height);
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, spec.bottom + spec.height / 2, spec.z);
      mesh.renderOrder = -10 + LAYERS.indexOf(spec);
      group.add(mesh);
      set.materials.push(material); set.textures.push(texture); set.layers.push({ spec, texture });
    }
    // Ground: lit, tiling both ways, reaching under the far layer and in front of the camera.
    const size = { w: 240, d: 120 };
    const ground = this.texture(assets.ground, size.w / GROUND_TILE_M, size.d / GROUND_TILE_M);
    const groundMaterial = new THREE.MeshLambertMaterial({ map: ground, transparent: !!this.current, opacity: this.current ? 0 : 1 });
    const geometry = new THREE.PlaneGeometry(size.w, size.d);
    this.geometries.push(geometry);
    const plane = new THREE.Mesh(geometry, groundMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 0, -size.d / 2 + 40);
    plane.renderOrder = -5;
    group.add(plane);
    set.ground = ground; set.groundMaterial = groundMaterial; set.textures.push(ground);
    return set;
  }
}
