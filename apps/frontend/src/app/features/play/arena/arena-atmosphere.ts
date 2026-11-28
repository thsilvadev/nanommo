/**
 * A region's air: soft mist wisps drifting low across the arena (battle band included) and tiny motes of
 * light floating very slowly round it, each glowing on its own beat. Seeded, laid out on a strip that
 * scrolls with the ground (the scenery group follows the camera in x); positions are computed here, on
 * the CPU, a few hundred points a frame.
 */
import * as THREE from 'three';
import type { ArenaRegionId } from './arena-region';

export interface ArenaAtmosphereSpec {
  /** Low mist sheets (billboards), in the region's mist colour. */
  wisps: { count: number; color: string; opacity: number };
  /** Tiny lights (additive points); `fall` (m/s) makes them come down like snow, looping from the top. */
  motes: { count: number; colors: string[]; size: number; fall?: number };
  /** Shafts of sunlight slanting down through the canopy (additive, fixed in the world, slowly breathing). */
  beams?: { count: number; color: string; opacity: number };
}

const ATMOSPHERE: Partial<Record<ArenaRegionId, ArenaAtmosphereSpec>> = {
  // The night forest: fireflies blinking among the trunks, a lilac mist low over the ground.
  kwaioua_forest: {
    wisps: { count: 22, color: '#5a4a8a', opacity: 0.24 },
    motes: { count: 280, colors: ['#d8ff7a', '#f0ff9a', '#b8ff8a'], size: 0.5 },
  },
  // A bright meadow under a clear sky: still air, no mist and nothing floating.
  green_grounds: {
    wisps: { count: 0, color: '#f4f8fb', opacity: 0 },
    motes: { count: 0, colors: ['#ffffff'], size: 0.4 },
  },
  // Sunset on the dry hills, a thin dust haze.
  menace_hills: {
    wisps: { count: 18, color: '#f4c49a', opacity: 0.2 },
    motes: { count: 0, colors: ['#ffc078', '#ffdca0', '#ff9a50'], size: 0.4 },
  },
  // A cold waste, a grey mist low over the ground.
  wastelands: {
    wisps: { count: 26, color: '#e8ecf0', opacity: 0.3 },
    motes: { count: 0, colors: ['#ffffff', '#f0f6ff', '#e6eef8'], size: 0.34 },
  },
  // A bright beach, sea spray drifting in low.
  ipora_beach: {
    wisps: { count: 16, color: '#f4fbff', opacity: 0.18 },
    motes: { count: 0, colors: ['#ffffff', '#fff6d0', '#e8fbff'], size: 0.36 },
  },
  // Sunset over the river, a pink mist rising off the water.
  gods_bridge: {
    wisps: { count: 22, color: '#f8c8b8', opacity: 0.22 },
    motes: { count: 0, colors: ['#ffd890', '#ffc078', '#fff0c0'], size: 0.42 },
  },
  // The ruin at night: pale spirit lights drifting among the stones, a blue mist, faint shafts of moonlight.
  forest_ruins: {
    wisps: { count: 24, color: '#4a5a8a', opacity: 0.24 },
    motes: { count: 240, colors: ['#a8e0ff', '#d0f0ff', '#88c8ff'], size: 0.46 },
    beams: { count: 8, color: '#8aa8ff', opacity: 0.09 },
  },
  caete: {
    wisps: { count: 34, color: '#dbe6d8', opacity: 0.34 },
    motes: { count: 260, colors: ['#fff6c0', '#f2ffd0', '#d8fff0'], size: 0.55 },
  },
};

export function arenaAtmosphere(region: ArenaRegionId): ArenaAtmosphereSpec | null {
  return ATMOSPHERE[region] ?? null;
}

/** Strip widths (m, scenery-local x wraps over them): wider than any view; past ~55 m the fog has it all. */
const MOTE_STRIP_M = 100;
const WISP_STRIP_M = 120;
/** Wisps drift with a faint breeze (m/s, towards +x). */
const WISP_WIND_M_S = 0.12;

export interface Mote { u: number; y: number; z: number; fall: number; color: string; phase: [number, number, number, number]; rate: [number, number, number, number] }
export interface Wisp { u: number; z: number; width: number; height: number; seed: number; bob: number }
export interface Beam { u: number; z: number; width: number; height: number; phase: number }
/** Sun shafts' strip and lean (screen-space shear: they all slant the same way, like light). */
const BEAM_STRIP_M = 110;
const BEAM_LEAN = 0.32;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function atmosphereLayout(spec: ArenaAtmosphereSpec): { motes: Mote[]; wisps: Wisp[]; beams: Beam[] } {
  const r = rng(0xa7b05);
  const range = (lo: number, hi: number) => lo + r() * (hi - lo);
  const motes = Array.from({ length: spec.motes.count }, (): Mote => ({
    u: r() * MOTE_STRIP_M, y: range(0.8, 4.6), z: range(-28, 14), fall: (spec.motes.fall ?? 0) * range(0.75, 1.25),
    color: spec.motes.colors[Math.floor(r() * spec.motes.colors.length)],
    phase: [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28],
    // Drift (x, y, z) about once a minute; the glow pulses every 6–15 s.
    rate: [range(0.05, 0.12), range(0.06, 0.13), range(0.04, 0.1), range(0.42, 1.05)],
  }));
  const wisps = Array.from({ length: spec.wisps.count }, (): Wisp => ({
    u: r() * WISP_STRIP_M, z: range(-26, 14), width: range(7, 14), height: range(2.4, 4.4), seed: r() * 100, bob: r() * 6.28,
  }));
  const beams = Array.from({ length: spec.beams?.count ?? 0 }, (): Beam => ({
    u: r() * BEAM_STRIP_M, z: range(-24, 6), width: range(1.6, 3.6), height: range(18, 26), phase: r() * 6.28,
  }));
  return { motes, wisps, beams };
}

/** Falling motes loop between this height and this much above it. */
const MOTE_FLOOR_M = 0.25, MOTE_FALL_SPAN_M = 6.5;
const wrap = (v: number, period: number) => ((((v % period) + period) % period) - period / 2);

/** A mote at `t` seconds when `travelled` metres have been walked (scenery-local x); `glow` 0..1. */
export function motePosition(m: Mote, t: number, travelled: number): { x: number; y: number; z: number; glow: number } {
  const [px, py, pz, pg] = m.phase, [rx, ry, rz, rg] = m.rate;
  const pulse = 0.5 + 0.5 * Math.sin(t * rg + pg);
  return {
    x: wrap(m.u - travelled + 1.6 * Math.sin(t * rx + px), MOTE_STRIP_M),
    y: m.fall ? MOTE_FLOOR_M + ((((m.y - MOTE_FLOOR_M - m.fall * t) % MOTE_FALL_SPAN_M) + MOTE_FALL_SPAN_M) % MOTE_FALL_SPAN_M) : m.y + 0.5 * Math.sin(t * ry + py),
    z: m.z + 1.2 * Math.sin(t * rz + pz),
    glow: pulse * pulse,
  };
}

/** A wisp's centre (scenery-local) at `t` seconds when `travelled` metres have been walked. */
export function wispPosition(w: Wisp, t: number, travelled: number): { x: number; y: number; z: number } {
  return { x: wrap(w.u - travelled + WISP_WIND_M_S * t, WISP_STRIP_M), y: w.height * 0.42 + 0.15 * Math.sin(t * 0.2 + w.bob), z: w.z };
}

/** A soft round glow (white, alpha falling off from a bright core). */
function glowTexture(): THREE.DataTexture {
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
    const a = Math.max(0, Math.min(1, d < 0.18 ? 1 : Math.exp(-((d - 0.18) * 5.2)) * (1 - d)));
    data.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
  }
  const texture = new THREE.DataTexture(data, n, n);
  texture.needsUpdate = true;
  return texture;
}

/** A sun shaft's foot (scenery-local, on the ground) and brightness (0..1, a slow breathing) at `t` seconds. */
export function beamPosition(b: Beam, t: number, travelled: number): { x: number; z: number; glow: number } {
  return { x: wrap(b.u - travelled, BEAM_STRIP_M), z: b.z, glow: 0.65 + 0.35 * Math.sin(t * 0.17 + b.phase) };
}

export class ArenaAtmosphere {
  readonly group = new THREE.Group();
  private readonly motes: Mote[];
  private readonly wisps: Wisp[];
  private readonly points: THREE.Points;
  private readonly pointsMaterial: THREE.PointsMaterial;
  private readonly glow = glowTexture();
  private readonly sheet: THREE.InstancedMesh;
  private readonly sheetMaterial: THREE.ShaderMaterial;
  private readonly moteColors: THREE.Color[];
  private readonly beams: Beam[];
  private readonly shafts: THREE.InstancedMesh | null = null;
  private readonly shaftMaterial: THREE.ShaderMaterial | null = null;
  private readonly m = new THREE.Matrix4();

  constructor(private readonly spec: ArenaAtmosphereSpec, fading: boolean) {
    this.group.name = 'arena:atmosphere';
    ({ motes: this.motes, wisps: this.wisps, beams: this.beams } = atmosphereLayout(spec));
    this.moteColors = this.motes.map((m) => new THREE.Color(m.color));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.motes.length * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.motes.length * 3), 3));
    this.pointsMaterial = new THREE.PointsMaterial({
      size: spec.motes.size, sizeAttenuation: true, map: this.glow, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: fading ? 0 : 1,
    });
    this.points = new THREE.Points(geometry, this.pointsMaterial);
    this.points.name = 'arena:motes';
    this.points.frustumCulled = false;

    this.sheetMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(spec.wisps.color) }, uOpacity: { value: fading ? 0 : spec.wisps.opacity }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        varying vec2 vUv; varying float vSeed;
        void main() {
          vUv = uv; vSeed = aSeed;
          // A billboard: the instance's centre and size, the quad spread in view space.
          vec4 centre = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
          vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
          centre.xy += position.xy * size;
          gl_Position = projectionMatrix * centre;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
        varying vec2 vUv; varying float vSeed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          vec2 q = vUv * vec2(3.0, 1.6) + vec2(vSeed, vSeed * 0.37) + vec2(uTime * 0.025, uTime * 0.008);
          float n = 0.55 * noise(q) + 0.3 * noise(q * 2.1 + 3.7) + 0.15 * noise(q * 4.3 - 1.3);
          vec2 d = (vUv - 0.5) * 2.0;
          // Soft ellipse, thinning out towards the ground (where the quad meets it) and the top.
          float body = (1.0 - smoothstep(0.25, 1.0, length(d))) * smoothstep(0.0, 0.3, vUv.y);
          float a = uOpacity * body * smoothstep(0.3, 0.75, n);
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(this.wisps.map((w) => w.seed)), 1));
    this.sheet = new THREE.InstancedMesh(quad, this.sheetMaterial, this.wisps.length);
    this.sheet.name = 'arena:wisps';
    this.sheet.frustumCulled = false;
    this.group.add(this.sheet);
    if (this.motes.length) this.group.add(this.points);

    if (spec.beams && this.beams.length) {
      this.shaftMaterial = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(spec.beams.color) }, uOpacity: { value: fading ? 0 : spec.beams.opacity }, uLean: { value: BEAM_LEAN } },
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float aGlow;
          uniform float uLean;
          varying vec2 vUv; varying float vGlow;
          void main() {
            vUv = uv; vGlow = aGlow;
            // Its foot on the ground (instance position), spread upwards in view space and sheared sideways.
            vec4 foot = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
            vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
            float up = (position.y + 0.5) * size.y;
            foot.xy += vec2(position.x * size.x + up * uLean, up);
            gl_Position = projectionMatrix * foot;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uOpacity;
          varying vec2 vUv; varying float vGlow;
          void main() {
            float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float a = uOpacity * vGlow * pow(across, 1.6) * smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
            if (a < 0.002) discard;
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
      });
      const quad = new THREE.PlaneGeometry(1, 1);
      quad.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(this.beams.length), 1));
      this.shafts = new THREE.InstancedMesh(quad, this.shaftMaterial, this.beams.length);
      this.shafts.name = 'arena:beams';
      this.shafts.frustumCulled = false;
      this.group.add(this.shafts);
    }
  }

  /** Place everything for `travelled` metres walked at `tSec` seconds. */
  update(travelled: number, tSec: number): void {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.motes.forEach((m, i) => {
      const p = motePosition(m, tSec, travelled), c = this.moteColors[i], k = 0.15 + 0.85 * p.glow;
      pos.setXYZ(i, p.x, p.y, p.z);
      col.setXYZ(i, c.r * k, c.g * k, c.b * k);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.wisps.forEach((w, i) => {
      const p = wispPosition(w, tSec, travelled);
      this.m.makeScale(w.width, w.height, 1).setPosition(p.x, p.y, p.z);
      this.sheet.setMatrixAt(i, this.m);
    });
    this.sheet.instanceMatrix.needsUpdate = true;
    this.sheetMaterial.uniforms['uTime'].value = tSec % 3600;
    if (this.shafts) {
      const glow = this.shafts.geometry.getAttribute('aGlow') as THREE.InstancedBufferAttribute;
      this.beams.forEach((b, i) => {
        const p = beamPosition(b, tSec, travelled);
        this.m.makeScale(b.width, b.height, 1).setPosition(p.x, 0, p.z);
        this.shafts!.setMatrixAt(i, this.m);
        glow.setX(i, p.glow);
      });
      this.shafts.instanceMatrix.needsUpdate = true;
      glow.needsUpdate = true;
    }
  }

  /** Crossfade between regions (0..1). */
  fade(f: number): void {
    this.pointsMaterial.opacity = f;
    this.sheetMaterial.uniforms['uOpacity'].value = this.spec.wisps.opacity * f;
    if (this.shaftMaterial) this.shaftMaterial.uniforms['uOpacity'].value = (this.spec.beams?.opacity ?? 0) * f;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.points.geometry.dispose();
    this.pointsMaterial.dispose();
    this.glow.dispose();
    this.sheet.geometry.dispose();
    this.sheetMaterial.dispose();
    this.sheet.dispose();
    this.shafts?.geometry.dispose();
    this.shaftMaterial?.dispose();
    this.shafts?.dispose();
  }
}
