/**
 * The arena backdrop: a tiling ground plane and three painted layers (sky, far,
 * near) behind the grid, each scrolled at its own speed while the party walks —
 * the characters stand still, the world slides left. Changing region crossfades
 * the layers.
 */
import * as THREE from 'three';
import { arenaRegionAssets, type ArenaRegionId } from './arena-region';
import { ARENA_NEAR_LAYER_DISTANCE_M, ArenaProps, arenaTreeShadows, type ArenaTreeShadow } from './arena-props';
import { ARENA_SEA_LEVEL_M, TERRAIN_GLSL, arenaShore } from './arena-terrain';
import { ArenaAtmosphere, arenaAtmosphere } from './arena-atmosphere';

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
  { key: 'near', z: -ARENA_NEAR_LAYER_DISTANCE_M, width: 120, height: 15, bottom: -1.2, repeat: 2, speed: 0.6, transparent: true },
];

/** Regions with no painted layer at all: a background, fog and (open sky) a 3D dome behind the 3D world (arenaLight). */
const NO_PAINTED_LAYERS: ReadonlySet<ArenaRegionId> = new Set(['kwaioua_forest', 'caete', 'forest_ruins', 'green_grounds', 'menace_hills', 'wastelands', 'ipora_beach', 'gods_bridge']);
/**
 * Regions drawn without the painted near layer (every region without painted layers, and those keeping only
 * sky + far): their middle ground is 3D plants, which a turning painted plane at 22 m would cut through.
 */
const NO_NEAR_LAYER: ReadonlySet<ArenaRegionId> = new Set([...NO_PAINTED_LAYERS]);
export function arenaHasNearLayer(region: ArenaRegionId): boolean { return !NO_NEAR_LAYER.has(region); }

/** Where a bridge deck ends behind the grid (world z): a parapet, then the drop to the river. */
const DECK_BACK_Z = -15;
const RIVER_Y = -1.8;
/** Where the beach meets the sea (metres behind the grid, about where the sand passes sea level). */
const SHORE_LINE_M = 29;
/** Fog colour for a sea in a region with no `background` (none today). */
const ARENA_SKY_FALLBACK = '#cfe8f4';
/** Regions whose ground is a bridge deck over a river. */
const BRIDGES: ReadonlySet<ArenaRegionId> = new Set(['gods_bridge']);

/** Light per region (hemisphere sky/ground, sun): the bridge is lit by a low warm sunset. */
/** `background`: clear colour (default the painted sky's blue); `fog`: distance fog in that colour; `stars`: a night dome; `groundTint`: multiplies the ground texture; `groundRecolor`: replaces its hue (its brightness times this colour). */
export interface ArenaLight { sky: string; ground: string; hemi: number; sun: string; sunIntensity: number; background?: string; fog?: { near: number; far: number }; stars?: boolean; groundTint?: string; groundRecolor?: string; dome?: ArenaSkyDome; meadow?: ArenaMeadow }
/**
 * A meadow floor: golden dry-grass patches laid over the grass in world space (bigger than a ground tile, so
 * they never repeat in view), the texture's blades kept in the patch's own colour. `cover` (0..1) is about how
 * much of the floor they take; `scale` their size (metres).
 */
export interface ArenaMeadow { dry: string; cover: number; scale: number }
/** A procedural sky (regions without painted layers under an open sky): `horizon` should be the fog colour; `mid` a band between it and the zenith, reached at `spread` (sine of the elevation, default 0.5); `below`: the dome under the horizon (default `horizon`), a land colour where there is no fog to hide the ground's far edge. */
export interface ArenaSkyDome { zenith: string; horizon: string; clouds: number; cloudColor: string; mid?: string; spread?: number; below?: string; sun?: { dir: [number, number, number]; color: string; size: number } }
const DEFAULT_LIGHT: ArenaLight = { sky: '#fff6e6', ground: '#5a6a3a', hemi: 1.6, sun: '#ffffff', sunIntensity: 2.2 };
const LIGHTS: Partial<Record<ArenaRegionId, ArenaLight>> = {
  // The sun sits where the river's glitter path points (34 m right, ~150 m out: buildBridge).
  gods_bridge: {
    sky: '#ffd2b0', ground: '#4a3a5a', hemi: 1.45, sun: '#ffb070', sunIntensity: 2.5, background: '#f3a27a', fog: { near: 14, far: 150 },
    dome: { zenith: '#3a2a6a', mid: '#c2577a', horizon: '#f3a27a', spread: 0.2, clouds: 0.35, cloudColor: '#ff9a8a', sun: { dir: [34, 9, -150], color: '#ffe0a0', size: 0.045 } },
  },
  kwaioua_forest: { sky: '#d6ccff', ground: '#352a3e', hemi: 1.2, sun: '#f2e4ff', sunIntensity: 1.65, background: '#080515', fog: { near: 14, far: 74 }, stars: true },
  // Caetê: a misty day under the canopy, soft green light; the mist reaches into the battle, the trunks fade into it.
  // Green grounds: a cosy, sun-warmed meadow under a clear blue sky, no fog: warm yellow-green grass with golden
  // dry patches, round trees casting soft shadows; the dome under the horizon is grass-coloured.
  green_grounds: {
    sky: '#fff2d6', ground: '#6a6a34', hemi: 1.55, sun: '#fff0d2', sunIntensity: 2.3, background: '#9ccdf2',
    dome: { zenith: '#2a7ee0', horizon: '#a8d4f2', below: '#9aa654', spread: 0.35, clouds: 0.5, cloudColor: '#ffffff' },
    meadow: { dry: '#caa44e', cover: 0.33, scale: 9 },
  },
  // Menace hills: dry rocky hills at sunset, crags fading into an orange dust haze under a darkening sky.
  menace_hills: {
    sky: '#ffe2c0', ground: '#4a3a30', hemi: 1.4, sun: '#ffc490', sunIntensity: 2.2, background: '#dca482', fog: { near: 10, far: 90 }, groundTint: '#a89c8e',
    dome: { zenith: '#3e2a52', horizon: '#dca482', clouds: 0.5, cloudColor: '#ffbe8a' },
  },
  // Wastelands: a cold, overcast waste; snowy peaks fading into a grey mist, snow drifting down.
  wastelands: {
    sky: '#e6eef8', ground: '#4a4a50', hemi: 1.5, sun: '#e8eef8', sunIntensity: 1.6, background: '#d2d7dc', fog: { near: 9, far: 115 }, groundTint: '#e2e2e0',
    dome: { zenith: '#8a94a2', horizon: '#d2d7dc', clouds: 0.9, cloudColor: '#eceef0' },
  },
  // Ipora beach: a bright tropical shore, the 3D sea running out to a pale horizon.
  ipora_beach: {
    sky: '#fff8e8', ground: '#c8a870', hemi: 1.7, sun: '#fff4e0', sunIntensity: 2.3, background: '#cfe8f4', fog: { near: 12, far: 120 },
    dome: { zenith: '#2a8ae6', horizon: '#cfe8f4', clouds: 0.4, cloudColor: '#ffffff' },
  },
  // Forest ruins: a starry night over the ruin, moonlight, a deep blue haze; the ground recoloured blue.
  forest_ruins: { sky: '#9fb4ff', ground: '#1c2236', hemi: 1.3, sun: '#c8d6ff', sunIntensity: 1.6, background: '#03040a', fog: { near: 14, far: 80 }, stars: true, groundRecolor: '#2c3a66' },
  caete: { sky: '#eef8e6', ground: '#3f4a30', hemi: 1.7, sun: '#fff4dc', sunIntensity: 1.2, background: '#a7bca9', fog: { near: 7, far: 56 } },
};
export function arenaLight(region: ArenaRegionId): ArenaLight { return LIGHTS[region] ?? DEFAULT_LIGHT; }

interface LayerSet {
  region: ArenaRegionId; group: THREE.Group; materials: THREE.MeshBasicMaterial[]; textures: THREE.Texture[]; layers: Array<{ spec: LayerSpec; texture: THREE.Texture }>;
  ground: THREE.Texture; groundMaterial: THREE.MeshLambertMaterial; travel: { value: number }; time: { value: number }; props: ArenaProps; bornAt: number;
  /** The painted layers (sky, far, near): they turn with the camera's yaw, like a sky box; the ground does not. */
  backdrop: THREE.Group;
  /** Extra materials faded with the ground (the bridge's river, wall and parapet). */
  extras: THREE.Material[];
  /** Mist wisps and motes of light (regions that have them). */
  atmosphere: ArenaAtmosphere | null;
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
      set.props.update(travelled, yawRad);
      set.backdrop.rotation.y = yawRad;
      set.atmosphere?.update(travelled, nowMs / 1000);
    }
    if (this.current) {
      const f = this.leaving ? Math.min(1, (nowMs - this.current.bornAt) / CROSSFADE_MS) : 1;
      for (const m of this.current.materials) m.opacity = f;
      this.current.groundMaterial.opacity = f;
      for (const m of this.current.extras) { m.opacity = f; const u = (m as THREE.ShaderMaterial).uniforms?.['opacity']; if (u) u.value = f; }
      this.current.atmosphere?.fade(f);
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
      set.atmosphere?.dispose();
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

  /** A starry night dome behind the 3D forest (night regions without painted layers): fixed points, never fogged. */
  private buildStars(set: LayerSet): void {
    const fading = !!this.current;
    let a = 0x5eed1234;
    const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const count = 1400, radius = 330;
    const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const az = r() * Math.PI * 2, el = Math.asin(0.02 + 0.98 * r() ** 1.6); // denser towards the horizon
      positions.set([Math.cos(el) * Math.sin(az) * radius, Math.sin(el) * radius - 20, -Math.cos(el) * Math.cos(az) * radius], i * 3);
      const b = 0.35 + 0.65 * r() ** 3;
      tint.setHSL(0.6 + 0.2 * r(), 0.5, 0.75).multiplyScalar(b);
      colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometries.push(geometry);
    const material = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: fading, opacity: fading ? 0 : 1 });
    const stars = new THREE.Points(geometry, material);
    stars.name = 'arena:stars';
    stars.frustumCulled = false;
    stars.renderOrder = -10;
    set.group.add(stars);
    set.extras.push(material);
  }

  /** An open sky: a gradient dome from the fog's colour at the horizon to the zenith, soft clouds drifting overhead. */
  private buildDome(set: LayerSet, dome: ArenaSkyDome): void {
    const fading = !!this.current;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(dome.zenith) }, uHorizon: { value: new THREE.Color(dome.horizon) },
        uCloud: { value: new THREE.Color(dome.cloudColor) }, uClouds: { value: dome.clouds }, uTime: set.time, opacity: { value: fading ? 0 : 1 },
        uBelow: { value: new THREE.Color(dome.below ?? dome.horizon) },
        uMid: { value: new THREE.Color(dome.mid ?? dome.zenith).lerp(new THREE.Color(dome.mid ? dome.mid : dome.horizon), dome.mid ? 0 : 0.5) }, uSpread: { value: dome.spread ?? 0.5 },
        uSunDir: { value: new THREE.Vector3(...(dome.sun?.dir ?? [0, 1, 0])).normalize() }, uSunColor: { value: new THREE.Color(dome.sun?.color ?? '#000000') }, uSunSize: { value: dome.sun?.size ?? 0 },
      },
      side: THREE.BackSide, depthWrite: false, fog: false, transparent: fading,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uCloud; uniform float uClouds; uniform float uTime; uniform float opacity;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize; uniform vec3 uMid; uniform float uSpread; uniform vec3 uBelow;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          vec3 d = normalize(vDir);
          float e = d.y;
          float t = pow(smoothstep(-0.02, uSpread, e), 0.75);
          vec3 col = t < 0.5 ? mix(uHorizon, uMid, t * 2.0) : mix(uMid, uZenith, t * 2.0 - 1.0);
          col = mix(col, uBelow, smoothstep(0.0, -0.03, e));
          if (e > 0.0) {
            vec2 p = d.xz / (e + 0.15) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
            float n = 0.5 * noise(p) + 0.28 * noise(p * 2.3 + 5.1) + 0.14 * noise(p * 4.7 - 2.3) + 0.08 * noise(p * 9.1);
            float c = smoothstep(0.78 - 0.32 * uClouds, 0.95 - 0.2 * uClouds, n) * smoothstep(0.0, 0.18, e);
            // Clouds melt into the haze near the horizon.
            col = mix(col, mix(uHorizon, uCloud, smoothstep(0.0, 0.25, e)), c * 0.9);
          }
          if (uSunSize > 0.0) {
            // The sun: a soft-edged disc and a wide glow round it.
            float a = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
            col = mix(col, uSunColor, 1.0 - smoothstep(uSunSize * 0.85, uSunSize, a));
            col += uSunColor * 0.35 * exp(-a / (uSunSize * 4.0));
          }
          gl_FragColor = vec4(col, opacity);
        }`,
    });
    const geometry = new THREE.SphereGeometry(300, 32, 16);
    this.geometries.push(geometry);
    const sky = new THREE.Mesh(geometry, material);
    sky.name = 'arena:dome';
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    set.group.add(sky);
    set.extras.push(material);
  }

  /**
   * The sea behind a beach: a wide plane at sea level (the sand runs down under it), turquoise in the shallows,
   * deep blue further out, wave crests and foam at the shore line, fading into the fog colour at the horizon.
   */
  private buildSea(set: LayerSet, light: ArenaLight): void {
    const fading = !!this.current;
    const fog = light.fog ?? { near: 60, far: 160 };
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTravel: set.travel, uTime: set.time, opacity: { value: fading ? 0 : 1 },
        uFog: { value: new THREE.Color(light.background ?? ARENA_SKY_FALLBACK) }, uFogNear: { value: fog.near }, uFogFar: { value: fog.far * 1.6 },
      },
      transparent: fading, fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld; varying float vLocalX;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vLocalX = position.x; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTravel; uniform float uTime; uniform float opacity; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
        varying vec3 vWorld; varying float vLocalX;
        void main() {
          // World-fixed coordinates: x along the shore (scrolls with the walk), d = metres out from the shore line.
          float x = vLocalX + uTravel;
          float d = -vWorld.z - ${SHORE_LINE_M.toFixed(1)};
          float deep = smoothstep(0.0, 40.0, d);
          vec3 col = mix(vec3(0.30, 0.80, 0.78), vec3(0.10, 0.42, 0.72), deep);
          float waves = sin(x * 0.35 + d * 0.9 - uTime * 1.1 + sin(x * 0.07) * 2.0) * sin(x * 0.11 - d * 0.4 + uTime * 0.6);
          col += vec3(0.06, 0.08, 0.08) * waves;
          // Crests: thin bright lines rolling towards the beach.
          float crest = smoothstep(0.92, 1.0, sin(d * 0.8 + uTime * 1.4 + sin(x * 0.13) * 1.5)) * (1.0 - deep);
          // Foam where the water meets the sand, the line breathing in and out.
          float edge = d - 0.6 * sin(uTime * 0.7 + x * 0.21) - 0.3 * sin(x * 0.53 + 1.0);
          float foam = (1.0 - smoothstep(0.0, 1.6, edge)) * (0.6 + 0.4 * sin(x * 1.7 + uTime * 2.0));
          col = mix(col, vec3(0.96, 0.98, 1.0), clamp(crest * 0.55 + foam, 0.0, 1.0));
          float dist = length(vWorld - cameraPosition);
          col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
          gl_FragColor = vec4(col, opacity);
        }`,
    });
    const geometry = new THREE.PlaneGeometry(320, 260);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, ARENA_SEA_LEVEL_M, -SHORE_LINE_M - 130 + 6);
    this.geometries.push(geometry);
    const sea = new THREE.Mesh(geometry, material);
    sea.name = 'arena:sea';
    sea.frustumCulled = false;
    set.group.add(sea);
    set.extras.push(material);
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
    const set: LayerSet = { region, group, materials: [], textures: [], layers: [], ground: null!, groundMaterial: null!, travel: { value: 0 }, time: { value: 0 }, props: null!, bornAt: nowMs, extras: [], pending: 0, backdrop: new THREE.Group(), atmosphere: null };
    set.backdrop.name = 'arena:backdrop';
    group.add(set.backdrop);
    this.building = set;
    // Painted layers: unlit, behind everything, never write depth (the grid draws over them).
    for (const spec of LAYERS) {
      if ((spec.key === 'near' && !arenaHasNearLayer(region)) || NO_PAINTED_LAYERS.has(region)) continue;
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
    // Without fog, the ground runs on under the hills (its far edge must never show between them).
    const depth = arenaLight(region).fog ? 120 : GROUND_DEPTH_CLEAR_M;
    const size = bridge ? { w: 240, d: 40 - DECK_BACK_Z } : { w: 240, d: depth };
    const centreZ = bridge ? (DECK_BACK_Z + 40) / 2 : -depth / 2 + 40;
    const ground = this.texture(assets.ground, size.w / GROUND_TILE_M, size.d / GROUND_TILE_M);
    const groundMaterial = new THREE.MeshLambertMaterial({ map: ground, color: arenaLight(region).groundTint ?? '#ffffff', transparent: !!this.current, opacity: this.current ? 0 : 1 });
    terrainShader(groundMaterial, set.travel, RELIEF[region] ?? 1, centreZ, arenaShore(region), arenaLight(region).groundRecolor, arenaLight(region).meadow, arenaTreeShadows(region));
    const geometry = new THREE.PlaneGeometry(size.w, size.d, size.w, size.d);
    this.geometries.push(geometry);
    const plane = new THREE.Mesh(geometry, groundMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 0, centreZ);
    plane.renderOrder = -5;
    plane.frustumCulled = false;
    group.add(plane);
    // Without a near layer nothing bounds the props: behind the far layer they go behind its opaque wall of trees.
    set.props = new ArenaProps(region, RELIEF[region] ?? 1, arenaHasNearLayer(region) ? ARENA_NEAR_LAYER_DISTANCE_M : Infinity);
    // The modelled props download with the textures: the region is ready once they are in.
    set.pending++;
    void set.props.loaded.then(() => { set.pending = Math.max(0, set.pending - 1); });
    group.add(set.props.group);
    if (bridge) this.buildBridge(set);
    if (arenaShore(region) > 0) this.buildSea(set, arenaLight(region));
    if (arenaLight(region).dome) this.buildDome(set, arenaLight(region).dome!);
    if (arenaLight(region).stars) this.buildStars(set);
    const air = arenaAtmosphere(region);
    if (air) { set.atmosphere = new ArenaAtmosphere(air, !!this.current); group.add(set.atmosphere.group); }
    set.ground = ground; set.groundMaterial = groundMaterial; set.textures.push(ground);
    this.building = null;
    return set;
  }
}

/** Depth of the ground plane (it reaches 40 m in front of the grid) where no fog hides its far edge. */
const GROUND_DEPTH_CLEAR_M = 170;

/**
 * Ground shader additions: the relief (vertices raised by the terrain height, normals from its slope)
 * and a less repetitive texture: a second, rotated sample at another scale blended in by a slow noise,
 * and a broad light/dark variation. `travel` (metres walked + camera x) keeps both fixed to the world.
 */
/** At most this many tree shadows on a region's ground (a fixed-size uniform array). */
const MAX_TREE_SHADOWS = 32;
function terrainShader(material: THREE.MeshLambertMaterial, travel: { value: number }, relief: number, centreZ: number, shore = 0, recolor?: string, meadow?: ArenaMeadow, shadows: ArenaTreeShadow[] = []): void {
  const shade = shadows.slice(0, MAX_TREE_SHADOWS).map((t) => new THREE.Vector4(t.u, t.z, t.radius, t.dx));
  while (shade.length < MAX_TREE_SHADOWS) shade.push(new THREE.Vector4(0, 0, 0, 0));
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uMeadowDry'] = { value: new THREE.Color(meadow?.dry ?? '#ffffff') };
    shader.uniforms['uMeadow'] = { value: new THREE.Vector3(meadow ? 1 : 0, meadow?.cover ?? 0, meadow?.scale ?? 1) };
    shader.uniforms['uShade'] = { value: shade };
    shader.uniforms['uShadeCount'] = { value: Math.min(shadows.length, MAX_TREE_SHADOWS) };
    shader.uniforms['uTravel'] = travel;
    shader.uniforms['uRelief'] = { value: relief };
    shader.uniforms['uShore'] = { value: shore };
    shader.uniforms['uRecolor'] = { value: new THREE.Color(recolor ?? '#ffffff') };
    shader.uniforms['uRecolorOn'] = { value: recolor ? 1 : 0 };
    shader.uniforms['uGroundZ'] = { value: centreZ };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTravel; uniform float uRelief; uniform float uShore; uniform float uGroundZ; varying vec2 vTerrain;
${TERRAIN_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
// Plane space: x along the ground, y = -(world z - uGroundZ), z up.
vec2 terrainAt = vec2(position.x + uTravel, -position.y + uGroundZ);
float hx = arenaHeight(terrainAt + vec2(0.25, 0.0), uRelief, uShore) - arenaHeight(terrainAt - vec2(0.25, 0.0), uRelief, uShore);
float hz = arenaHeight(terrainAt + vec2(0.0, 0.25), uRelief, uShore) - arenaHeight(terrainAt - vec2(0.0, 0.25), uRelief, uShore);
vec3 objectNormal = normalize(vec3(-hx / 0.5, hz / 0.5, 1.0));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position.xy, arenaHeight(terrainAt, uRelief, uShore));
vTerrain = terrainAt;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vTerrain; uniform vec3 uRecolor; uniform float uRecolorOn;
uniform vec3 uMeadowDry; uniform vec3 uMeadow; uniform vec4 uShade[${MAX_TREE_SHADOWS}]; uniform int uShadeCount;
// Sine-free hash (Hoskins): stays stable far from the origin, where sin() of a big argument bands.
float meadowHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float meadowNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(meadowHash(i), meadowHash(i + vec2(1.0, 0.0)), u.x), mix(meadowHash(i + vec2(0.0, 1.0)), meadowHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float meadowFbm(vec2 p) { return 0.55 * meadowNoise(p) + 0.3 * meadowNoise(p * 2.3 + 7.1) + 0.15 * meadowNoise(p * 5.1 + 3.7); }`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 tileA = texture2D(map, vMapUv);
  vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * (vTerrain / 9.3);
  vec4 tileB = texture2D(map, uvB);
  float mixB = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(0.08 * vTerrain.x + 0.13 * vTerrain.y + 0.9 * sin(0.05 * vTerrain.x - 0.03 * vTerrain.y)));
  vec4 tile = mix(tileA, tileB, mixB * 0.85);
  float broad = 0.5 + 0.5 * (0.6 * sin(0.045 * vTerrain.x + 0.07 * vTerrain.y) + 0.4 * sin(0.11 * vTerrain.x - 0.05 * vTerrain.y + 1.7));
  tile.rgb *= mix(0.84, 1.1, broad);
  // A recoloured ground keeps the texture's light and dark, in the region's own hue.
  tile.rgb = mix(tile.rgb, vec3(dot(tile.rgb, vec3(0.3, 0.59, 0.11))) * uRecolor * 2.2, uRecolorOn);
  if (uMeadow.x > 0.5) {
    // Golden dry-grass patches with ragged edges, in world space (unwrapped: a wrap would draw a straight seam).
    vec2 mp = vTerrain / uMeadow.z;
    float n = meadowFbm(mp) + 0.12 * (meadowNoise(mp * 9.0) - 0.5);
    float dry = smoothstep(1.0 - uMeadow.y - 0.07, 1.0 - uMeadow.y + 0.07, n * 1.25 - 0.1);
    float lum = dot(tile.rgb, vec3(0.3, 0.59, 0.11));
    tile.rgb = mix(tile.rgb, (0.35 + 1.6 * lum) * uMeadowDry, dry);
  }
  // Soft, dappled shadows of the trees (the sun stands up-left in front: they fall right and back).
  float shadow = 0.0;
  for (int i = 0; i < ${MAX_TREE_SHADOWS}; i++) {
    if (i >= uShadeCount) break;
    vec4 t = uShade[i];
    vec2 d = vec2(mod(vTerrain.x - t.x + 180.0, 180.0) - 90.0 - t.w, vTerrain.y - t.y + 0.6 * t.w);
    float r = length(d * vec2(0.85, 1.25)) / t.z;
    float dapple = 0.16 * (meadowNoise(vTerrain * 1.7 + float(i) * 3.1) - 0.5);
    shadow = max(shadow, 1.0 - smoothstep(0.62, 1.0, r + dapple));
  }
  tile.rgb *= 1.0 - 0.45 * shadow;
  diffuseColor *= tile;
#endif`);
  };
  material.customProgramCacheKey = () => `arena-terrain:${shore > 0 ? 'shore' : 'land'}:${meadow ? 'meadow' : 'plain'}`;
}
