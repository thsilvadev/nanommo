/**
 * The arena backdrop: a tiling ground plane and three painted layers (sky, far,
 * near) behind the grid, each scrolled at its own speed while the party walks —
 * the characters stand still, the world slides left. Changing region crossfades
 * the layers.
 */
import * as THREE from 'three';
import { arenaRegionAssets, type ArenaRegionId } from './arena-region';
import { ArenaProps } from './arena-props';
import { TERRAIN_GLSL } from './arena-terrain';

/** Walking pace of the ground, metres per second. */
export const ARENA_WALK_SPEED_M_S = 1.4;
const CROSSFADE_MS = 600;
/** Ground tile size in metres (one 512 px texture). */
const GROUND_TILE_M = 7;
/** How much each region's ground rises behind and in front of the grid (0: flat). */
const RELIEF: Record<ArenaRegionId, number> = {
  green_grounds: 1, menace_hills: 1.5, kwaioua_forest: 1.1, wastelands: 1.2, caete: 0.9, forest_ruins: 1, ipora_beach: 0.6, gods_bridge: 0,
};

interface LayerSpec { key: 'sky' | 'far' | 'near'; z: number; width: number; height: number; bottom: number; repeat: number; speed: number; transparent: boolean }
/** Every layer image is 4:1; width / repeat / height keeps that ratio. Speeds are fractions of the ground speed. */
const LAYERS: LayerSpec[] = [
  { key: 'sky', z: -120, width: 560, height: 140, bottom: -20, repeat: 1, speed: 0.04, transparent: false },
  { key: 'far', z: -70, width: 168, height: 42, bottom: -9, repeat: 1, speed: 0.22, transparent: true },
  { key: 'near', z: -22, width: 120, height: 15, bottom: -1.2, repeat: 2, speed: 0.6, transparent: true },
];

/** Where a bridge deck ends behind the grid (world z): a parapet, then the drop to the river. */
const DECK_BACK_Z = -15;
const RIVER_Y = -1.8;
/** Regions whose ground is a bridge deck over a river. */
const BRIDGES: ReadonlySet<ArenaRegionId> = new Set(['gods_bridge']);

/** Light per region (hemisphere sky/ground, sun): the bridge is lit by a low warm sunset. */
export interface ArenaLight { sky: string; ground: string; hemi: number; sun: string; sunIntensity: number }
const DEFAULT_LIGHT: ArenaLight = { sky: '#fff6e6', ground: '#5a6a3a', hemi: 1.6, sun: '#ffffff', sunIntensity: 2.2 };
const LIGHTS: Partial<Record<ArenaRegionId, ArenaLight>> = {
  gods_bridge: { sky: '#ffd2b0', ground: '#4a3a5a', hemi: 1.45, sun: '#ffb070', sunIntensity: 2.5 },
};
export function arenaLight(region: ArenaRegionId): ArenaLight { return LIGHTS[region] ?? DEFAULT_LIGHT; }

interface LayerSet {
  region: ArenaRegionId; group: THREE.Group; materials: THREE.MeshBasicMaterial[]; textures: THREE.Texture[]; layers: Array<{ spec: LayerSpec; texture: THREE.Texture }>;
  ground: THREE.Texture; groundMaterial: THREE.MeshLambertMaterial; travel: { value: number }; time: { value: number }; props: ArenaProps; bornAt: number;
  /** The painted layers (sky, far, near): they turn with the camera's yaw, like a sky box; the ground does not. */
  backdrop: THREE.Group;
  /** Extra materials faded with the ground (the bridge's river, wall and parapet). */
  extras: THREE.Material[];
  /** Textures still downloading (the region is drawn whole once this is 0; a failed one counts as done). */
  pending: number;
}

export class ArenaScenery {
  readonly group = new THREE.Group();
  private readonly loader = new THREE.TextureLoader();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private current: LayerSet | null = null;
  private leaving: LayerSet | null = null;
  private wanted: ArenaRegionId | null = null;
  /** Metres walked so far (drives every layer's texture offset). */
  private walked = 0;
  /** The set whose textures build() is creating (they count themselves into its `pending`). */
  private building: LayerSet | null = null;

  constructor(private readonly maxAnisotropy: number) {
    this.group.name = 'arena:scenery';
  }

  /** Is `region` the scenery shown, with every texture loaded (the map fade clears only then)? */
  ready(region: ArenaRegionId): boolean {
    return this.current?.region === region && this.current.pending === 0;
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

  /**
   * Advance the scroll by `dtMs` at `scroll` (0..1 of the walk speed) and settle a crossfade; the painted
   * layers turn by `yawRad` round the look point (the player's orbit) so they always fill the view. The
   * scenery stays centred on the camera (`cameraX`, metres): moving the camera right reads as walking
   * that far, so the ground stays put under the actors and the layers slide by their parallax.
   */
  update(scroll: number, dtMs: number, nowMs: number, cameraX = 0, yawRad = 0): void {
    this.walked += ARENA_WALK_SPEED_M_S * scroll * (dtMs / 1000);
    this.group.position.x = cameraX;
    const travelled = this.walked + cameraX;
    for (const set of [this.current, this.leaving]) {
      if (!set) continue;
      for (const { spec, texture } of set.layers) texture.offset.x = ((travelled * spec.speed) / (spec.width / spec.repeat)) % 1;
      set.ground.offset.x = (travelled / GROUND_TILE_M) % 1;
      set.travel.value = travelled;
      set.time.value = (nowMs % 600_000) / 1000;
      set.props.update(travelled);
      set.backdrop.rotation.y = yawRad;
    }
    if (this.current) {
      const f = this.leaving ? Math.min(1, (nowMs - this.current.bornAt) / CROSSFADE_MS) : 1;
      for (const m of this.current.materials) m.opacity = f;
      this.current.groundMaterial.opacity = f;
      for (const m of this.current.extras) m.opacity = f;
      if (this.leaving && f >= 1) { this.dispose(this.leaving); this.leaving = null; }
    }
  }

  dispose(set?: LayerSet): void {
    if (set) {
      set.group.removeFromParent();
      for (const m of set.materials) m.dispose();
      set.groundMaterial.dispose();
      for (const m of set.extras) m.dispose();
      set.props.dispose();
      for (const t of set.textures) t.dispose();
      return;
    }
    if (this.current) this.dispose(this.current);
    if (this.leaving) this.dispose(this.leaving);
    this.current = this.leaving = null;
    for (const g of this.geometries) g.dispose();
  }

  private texture(url: string, repeatX: number, repeatY = 1): THREE.Texture {
    const set = this.building;
    if (set) set.pending++;
    const settle = () => { if (set) set.pending = Math.max(0, set.pending - 1); };
    const texture = this.loader.load(url, settle, undefined, settle);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = repeatY > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = this.maxAnisotropy;
    return texture;
  }

  /** The river below the deck (animated, sunset reflection), the deck's side wall and its parapet rails. */
  private buildBridge(set: LayerSet): void {
    const fading = !!this.current;
    const river = new THREE.ShaderMaterial({
      uniforms: { uTravel: set.travel, uTime: set.time, opacity: { value: fading ? 0 : 1 } },
      transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() { vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTravel; uniform float uTime; uniform float opacity;
        varying vec2 vLocal;
        void main() {
          // Plane space: x along the river (scenery-local), y = depth away from the deck (0 at the wall).
          float far = clamp(vLocal.y / 100.0, 0.0, 1.0);
          vec3 col = mix(vec3(0.20, 0.17, 0.36), vec3(0.85, 0.48, 0.38), pow(far, 0.7));
          float x = vLocal.x + uTravel;
          float waves = sin(x * 0.55 + uTime * 1.3 + sin(vLocal.y * 0.35)) * sin(vLocal.y * 1.4 - uTime * 0.9 + x * 0.12);
          col += vec3(0.05, 0.04, 0.07) * waves;
          // The sun's glitter path, held in front of the camera like the sun itself.
          // The sun is painted ~34 m right of centre on the sky, 150 m from the camera: its path on the water.
          float path = exp(-pow((vLocal.x - 34.0 * (45.0 + vLocal.y) / 150.0) / (2.5 + vLocal.y * 0.12), 2.0));
          float glint = smoothstep(0.55, 0.95, waves * 0.5 + 0.5);
          col += vec3(1.0, 0.82, 0.55) * path * (0.25 + 0.75 * glint) * (0.35 + 0.65 * far);
          gl_FragColor = vec4(col, opacity);
        }`,
    });
    const riverGeometry = new THREE.PlaneGeometry(240, 110);
    this.geometries.push(riverGeometry);
    const water = new THREE.Mesh(riverGeometry, river);
    water.rotation.x = -Math.PI / 2;
    // Plane y runs to -z after the rotation: shift so y = 0 is the wall and y grows away from it.
    riverGeometry.translate(0, 55, 0);
    water.position.set(0, RIVER_Y, DECK_BACK_Z);
    // Drawn between the sky and the far layer (the far shore is painted over it); never writes depth.
    water.renderOrder = -9.5;
    water.frustumCulled = false;
    set.group.add(water);

    const stone = (color: string) => new THREE.MeshLambertMaterial({ color, transparent: fading, opacity: fading ? 0 : 1 });
    const wallMaterial = stone('#7d6c56'), railMaterial = stone('#b8a888');
    const wallGeometry = new THREE.PlaneGeometry(240, -RIVER_Y + 0.2);
    const railGeometry = new THREE.BoxGeometry(240, 0.2, 0.55);
    const curbGeometry = new THREE.BoxGeometry(240, 0.28, 0.7);
    this.geometries.push(wallGeometry, railGeometry, curbGeometry);
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(0, RIVER_Y / 2, DECK_BACK_Z);
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.set(0, 1.02, DECK_BACK_Z + 0.4);
    const curb = new THREE.Mesh(curbGeometry, railMaterial);
    curb.position.set(0, 0.14, DECK_BACK_Z + 0.4);
    for (const m of [wall, rail, curb]) { m.frustumCulled = false; set.group.add(m); }
    set.extras.push(river, wallMaterial, railMaterial);
  }

  private build(region: ArenaRegionId, nowMs: number): LayerSet {
    const assets = arenaRegionAssets(region);
    const group = new THREE.Group();
    group.name = `arena:scenery:${region}`;
    const set: LayerSet = { region, group, materials: [], textures: [], layers: [], ground: null!, groundMaterial: null!, travel: { value: 0 }, time: { value: 0 }, props: null!, bornAt: nowMs, extras: [], pending: 0, backdrop: new THREE.Group() };
    set.backdrop.name = 'arena:backdrop';
    group.add(set.backdrop);
    this.building = set;
    // Painted layers: unlit, behind everything, never write depth (the grid draws over them).
    for (const spec of LAYERS) {
      const texture = this.texture(assets[spec.key], spec.repeat);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: this.current ? 0 : 1, depthWrite: false, fog: false });
      const geometry = new THREE.PlaneGeometry(spec.width, spec.height);
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, spec.bottom + spec.height / 2, spec.z);
      mesh.renderOrder = -10 + LAYERS.indexOf(spec);
      set.backdrop.add(mesh);
      set.materials.push(material); set.textures.push(texture); set.layers.push({ spec, texture });
    }
    // Ground: lit, tiling both ways, reaching under the far layer and in front of the camera. 1 m quads
    // so the relief (flat across the grid) can rise behind and in front of it.
    // A bridge deck stops at its parapet behind the grid; elsewhere the ground runs to the far layer.
    const bridge = BRIDGES.has(region);
    const size = bridge ? { w: 240, d: 40 - DECK_BACK_Z } : { w: 240, d: 120 };
    const centreZ = bridge ? (DECK_BACK_Z + 40) / 2 : GROUND_Z;
    const ground = this.texture(assets.ground, size.w / GROUND_TILE_M, size.d / GROUND_TILE_M);
    const groundMaterial = new THREE.MeshLambertMaterial({ map: ground, transparent: !!this.current, opacity: this.current ? 0 : 1 });
    terrainShader(groundMaterial, set.travel, RELIEF[region] ?? 1, centreZ);
    const geometry = new THREE.PlaneGeometry(size.w, size.d, size.w, size.d);
    this.geometries.push(geometry);
    const plane = new THREE.Mesh(geometry, groundMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 0, centreZ);
    plane.renderOrder = -5;
    plane.frustumCulled = false;
    group.add(plane);
    set.props = new ArenaProps(region, RELIEF[region] ?? 1);
    group.add(set.props.group);
    if (bridge) this.buildBridge(set);
    set.ground = ground; set.groundMaterial = groundMaterial; set.textures.push(ground);
    this.building = null;
    return set;
  }
}

/** The ground plane's centre depth (world z): it reaches 40 m in front of the grid. */
const GROUND_Z = -120 / 2 + 40;

/**
 * Ground shader additions: the relief (vertices raised by the terrain height, normals from its slope)
 * and a less repetitive texture: a second, rotated sample at another scale blended in by a slow noise,
 * and a broad light/dark variation. `travel` (metres walked + camera x) keeps both fixed to the world.
 */
function terrainShader(material: THREE.MeshLambertMaterial, travel: { value: number }, relief: number, centreZ: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uTravel'] = travel;
    shader.uniforms['uRelief'] = { value: relief };
    shader.uniforms['uGroundZ'] = { value: centreZ };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTravel; uniform float uRelief; uniform float uGroundZ; varying vec2 vTerrain;
${TERRAIN_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
// Plane space: x along the ground, y = -(world z - uGroundZ), z up.
vec2 terrainAt = vec2(position.x + uTravel, -position.y + uGroundZ);
float hx = arenaHeight(terrainAt + vec2(0.25, 0.0), uRelief) - arenaHeight(terrainAt - vec2(0.25, 0.0), uRelief);
float hz = arenaHeight(terrainAt + vec2(0.0, 0.25), uRelief) - arenaHeight(terrainAt - vec2(0.0, 0.25), uRelief);
vec3 objectNormal = normalize(vec3(-hx / 0.5, hz / 0.5, 1.0));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position.xy, arenaHeight(terrainAt, uRelief));
vTerrain = terrainAt;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vTerrain;`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 tileA = texture2D(map, vMapUv);
  vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * (vTerrain / 9.3);
  vec4 tileB = texture2D(map, uvB);
  float mixB = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(0.08 * vTerrain.x + 0.13 * vTerrain.y + 0.9 * sin(0.05 * vTerrain.x - 0.03 * vTerrain.y)));
  vec4 tile = mix(tileA, tileB, mixB * 0.85);
  float broad = 0.5 + 0.5 * (0.6 * sin(0.045 * vTerrain.x + 0.07 * vTerrain.y) + 0.4 * sin(0.11 * vTerrain.x - 0.05 * vTerrain.y + 1.7));
  tile.rgb *= mix(0.84, 1.1, broad);
  diffuseColor *= tile;
#endif`);
  };
  material.customProgramCacheKey = () => 'arena-terrain';
}
