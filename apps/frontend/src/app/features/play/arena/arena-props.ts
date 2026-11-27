/**
 * The arena's 3D ground props (rocks, bushes, logs, twigs, leaves, pebbles):
 * one InstancedMesh per kind, laid out by arena-prop-layout, sitting on the
 * terrain and scrolled with the ground. Low-poly, flat-shaded, coloured per
 * instance (and per vertex for shading such as log ends and bush bottoms).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARENA_ASSET_BASE, type ArenaRegionId } from './arena-region';
import { ARENA_TRUNK_HEIGHT_M, MODEL_PROPS, arenaPropLayout, propLocalX, type ArenaPropInstance, type ArenaPropKind } from './arena-prop-layout';
import { arenaShore, terrainHeight } from './arena-terrain';

/**
 * Distance (m, from the scenery origin along the view) of the painted near layer, which turns with the
 * camera yaw. Painted layers are transparent, so three.js draws them after every opaque mesh: a prop
 * behind that plane would show the painting through it.
 */
export const ARENA_NEAR_LAYER_DISTANCE_M = 22;
/** Extra shrink room (m) at the orbit limit: a prop turned towards the layer eases out over a few degrees. */
const NEAR_LAYER_EASE_M = 4;

/**
 * Scale (0..1) of a prop standing at scenery-local (x, z) that reaches `reach` metres round its base, for a
 * camera yaw (radians): it shrinks about its base so its far edge never passes the painted near layer
 * (whole, never sliced), and is gone once its base is behind it. From the front (yaw 0) only props that
 * would cross the layer change; turned, they ease out over a few more metres.
 */
export function nearLayerScale(x: number, z: number, reach: number, yawRad: number, layerDistance = ARENA_NEAR_LAYER_DISTANCE_M): number {
  const along = -x * Math.sin(yawRad) - z * Math.cos(yawRad);
  const room = reach + NEAR_LAYER_EASE_M * Math.abs(Math.sin(yawRad));
  return Math.min(1, Math.max(0, (layerDistance - along) / Math.max(room, 1e-6)));
}

/** The modelled kinds' geometries (one download, shared by every region; never disposed). */
let modelGeometries: Promise<Map<ArenaPropKind, THREE.BufferGeometry>> | null = null;
function loadModelGeometries(): Promise<Map<ArenaPropKind, THREE.BufferGeometry>> {
  modelGeometries ??= new GLTFLoader().loadAsync(`${ARENA_ASSET_BASE}props.glb`).then((gltf) => {
    const out = new Map<ArenaPropKind, THREE.BufferGeometry>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !o.name.startsWith('prop_')) return;
      const geometry = mesh.geometry.clone();
      geometry.computeVertexNormals();
      out.set(o.name.slice('prop_'.length) as ArenaPropKind, geometry);
    });
    return out;
  }).catch((error) => { modelGeometries = null; throw error; });
  return modelGeometries;
}

/** Deterministic jitter from a vertex position (shared corners move together). */
const jitter = (x: number, y: number, z: number, k: number) => Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k) * 43758.5453 % 1;

function shade(geometry: THREE.BufferGeometry, f: (p: THREE.Vector3, n: THREE.Vector3) => number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
    const v = f(p, n);
    colors.set([v, v, v], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function lumpy(radius: number, detail: number, squash: number, k: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const s = 1 + 0.28 * jitter(Math.round(v.x * 1e3), Math.round(v.y * 1e3), Math.round(v.z * 1e3), k);
    pos.setXYZ(i, v.x * s, v.y * s * squash, v.z * s);
  }
  return g;
}

function geometryOf(kind: ArenaPropKind): THREE.BufferGeometry {
  switch (kind) {
    case 'rock': {
      const g = lumpy(1, 1, 0.62, 1.7); g.translate(0, 0.38, 0);
      return shade(g, (p) => 0.8 + 0.25 * Math.min(1, Math.max(0, p.y / 1)));
    }
    case 'block': {
      const g = new THREE.BoxGeometry(1.3, 0.7, 0.85, 2, 1, 2);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (1 + 0.06 * jitter(pos.getX(i), pos.getY(i), pos.getZ(i), 3)), pos.getY(i), pos.getZ(i) * (1 + 0.06 * jitter(pos.getZ(i), pos.getY(i), pos.getX(i), 5)));
      g.translate(0, 0.3, 0);
      return shade(g, (p, n) => (n.y > 0.7 ? 1.08 : 0.86) + 0.05 * Math.sin(p.x * 9));
    }
    case 'bush': {
      const parts = [[0, 0.45, 0, 0.62], [0.45, 0.35, 0.15, 0.48], [-0.42, 0.33, -0.1, 0.5], [0.1, 0.38, 0.42, 0.45], [-0.05, 0.75, -0.05, 0.42]]
        .map(([x, y, z, r], i) => { const g = lumpy(r, 1, 0.9, i * 2.3); g.translate(x, y, z); return g; });
      const g = mergeGeometries(parts)!;
      return shade(g, (p) => 0.62 + 0.5 * Math.min(1, Math.max(0, p.y / 1.1)));
    }
    case 'log': {
      const g = new THREE.CylinderGeometry(0.2, 0.22, 2.2, 10, 1);
      g.rotateZ(Math.PI / 2); g.translate(0, 0.16, 0);
      return shade(g, (p, n) => (Math.abs(n.x) > 0.9 ? 1.55 : 0.82 + 0.16 * Math.sin(Math.atan2(p.z, p.y - 0.16) * 7 + p.x * 3)));
    }
    case 'twig': {
      const main = new THREE.CylinderGeometry(0.022, 0.034, 1, 5, 1); main.rotateZ(Math.PI / 2);
      const branch = new THREE.CylinderGeometry(0.014, 0.02, 0.38, 4, 1); branch.rotateZ(Math.PI / 2); branch.rotateY(0.7); branch.translate(0.12, 0, 0.1);
      const g = mergeGeometries([main.toNonIndexed(), branch.toNonIndexed()])!; g.translate(0, 0.03, 0);
      return shade(g, () => 0.95);
    }
    case 'leaf': {
      const g = new THREE.CircleGeometry(0.5, 6); g.scale(1, 0.48, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0.012, 0);
      return shade(g, (p) => 0.9 + 0.2 * Math.max(0, p.x));
    }
    case 'pebble': {
      const g = lumpy(0.5, 0, 0.6, 9.1); g.translate(0, 0.12, 0);
      return shade(g, (p) => 0.85 + 0.3 * Math.max(0, p.y / 0.3));
    }
    case 'post': {
      const g = new THREE.BoxGeometry(0.42, 1.12, 0.42); g.translate(0, 0.56, 0);
      return shade(g, (_p, n) => (n.y > 0.7 ? 1.1 : 0.9));
    }
    case 'palm':
      return palmGeometry();
    case 'trunk':
      return trunkGeometry();
    case 'bigleaf':
      return bigleafGeometry();
    case 'sprout':
      return sproutGeometry();
    case 'column':
      return columnGeometry();
    case 'hill':
      return hillGeometry();
    case 'blossom':
      return blossomGeometry();
    case 'starfish': {
      // A starfish (0.3 m across): five tapering arms, a raised middle.
      const verts: number[] = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2, l = a - 0.32, r = a + 0.32;
        const tip = [Math.cos(a) * 0.16, 0.012, Math.sin(a) * 0.16], left = [Math.cos(l) * 0.05, 0.022, Math.sin(l) * 0.05], right = [Math.cos(r) * 0.05, 0.022, Math.sin(r) * 0.05];
        verts.push(0, 0.035, 0, ...right, ...tip, 0, 0.035, 0, ...tip, ...left);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      return shade(g, (p) => 0.85 + 6 * p.y);
    }
    case 'shell': {
      // A little scallop shell (0.12 m): a ribbed fan lying on the sand.
      const verts: number[] = [], n = 6;
      for (let k = 0; k < n; k++) {
        const a0 = -1.1 + (2.2 * k) / n, a1 = -1.1 + (2.2 * (k + 1)) / n, am = (a0 + a1) / 2;
        verts.push(0, 0.012, 0.04, Math.sin(a1) * 0.1, 0.012, -Math.cos(a1) * 0.1 + 0.04, Math.sin(am) * 0.11, 0.035, -Math.cos(am) * 0.11 + 0.04);
        verts.push(0, 0.012, 0.04, Math.sin(am) * 0.11, 0.035, -Math.cos(am) * 0.11 + 0.04, Math.sin(a0) * 0.1, 0.012, -Math.cos(a0) * 0.1 + 0.04);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      return shade(g, (p) => 0.85 + 4 * p.y);
    }
    case 'peak': {
      // A mountain (radius 1, 1.3 high): a rough cone, rock below and snow above, its foot sunk in the ground.
      const g = new THREE.ConeGeometry(1, 1.3, 12, 6);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = 1 + 0.12 * jitter(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), 3);
        pos.setXYZ(i, x * k, y + 0.05 * jitter(Math.round(x * 50), 4, Math.round(z * 50), 5) * (y < 0.6 ? 1 : 0), z * k);
      }
      g.translate(0, 0.6, 0);
      return shadeRgb(g, (p, n) => {
        const snow = p.y > 0.75 + 0.12 * Math.sin(Math.atan2(p.z, p.x) * 4) && n.y > 0.25;
        return snow ? [1.05, 1.07, 1.1] : [0.55, 0.56, 0.6];
      });
    }
    case 'snow': {
      // A flat patch of old snow (about 0.9 x 0.6), a low dome over an irregular ring.
      const verts: number[] = [];
      const n = 12;
      const ring = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2, r = 0.5 * (0.85 + 0.15 * Math.sin(k * 1.9 + 1)); return [Math.cos(a) * r, 0.012, Math.sin(a) * r * 0.66]; });
      for (let k = 0; k < n; k++) verts.push(0, 0.03, 0, ...ring[(k + 1) % n], ...ring[k]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      return shade(g, () => 1);
    }
    case 'crag': {
      // A jagged rock spire (about 1.2 wide, 2.6 tall): a tapering seven-sided cone, every vertex knocked about.
      const g = new THREE.CylinderGeometry(0.16, 0.62, 2.6, 7, 4);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = 1 + 0.32 * jitter(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), 6);
        pos.setXYZ(i, x * k + 0.12 * Math.sin(y * 2.1), y + (y > 1.2 ? 0.35 * jitter(Math.round(x * 100), 1, Math.round(z * 100), 2) : 0), z * k);
      }
      g.translate(0, 1.2, 0);
      g.deleteAttribute('uv');
      return shade(g, (p, n) => 0.78 + 0.18 * Math.min(1, p.y / 2.6) + (n.y > 0.5 ? 0.14 : 0));
    }
    case 'slab': {
      const g = new THREE.BoxGeometry(1, 0.07, 0.68, 2, 1, 2);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (1 + 0.1 * jitter(pos.getX(i), 1, pos.getZ(i), 7)), pos.getY(i) + (pos.getY(i) > 0 ? 0.02 * jitter(pos.getX(i), 2, pos.getZ(i), 8) : 0), pos.getZ(i) * (1 + 0.1 * jitter(pos.getZ(i), 3, pos.getX(i), 9)));
      g.translate(0, 0.015, 0);
      return shade(g, (p, n) => (n.y > 0.7 ? 1.02 : 0.8) + 0.06 * Math.sin(p.x * 11 + p.z * 7));
    }
    default:
      throw new Error(`arena prop ${kind} is modelled (props.glb), not built`);
  }
}

/** Paints a geometry one colour (vertex colours carry the real colour; the instance colour is near white). */
function paint(g: THREE.BufferGeometry, color: string, vary = 0): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  // Same attributes on every part (mergeGeometries refuses a mix): position, normal, color.
  out.deleteAttribute('uv');
  out.computeVertexNormals();
  const c = new THREE.Color(color), pos = out.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const k = 1 + vary * Math.sin(pos.getY(i) * 7.1 + pos.getX(i) * 3.3); colors.set([c.r * k, c.g * k, c.b * k], i * 3); }
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return out;
}

/** A coconut palm about 6 m tall: a leaning ringed trunk, nine drooping fronds, coconuts. */
function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const H = 5.6, lean = 1.3, segments = 8;
  const at = (t: number) => new THREE.Vector3(lean * t * t, H * t, 0);
  for (let k = 0; k < segments; k++) {
    const a = at(k / segments), b = at((k + 1) / segments), len = a.distanceTo(b);
    const seg = new THREE.CylinderGeometry(0.15 - 0.05 * ((k + 1) / segments), 0.2 - 0.05 * (k / segments), len, 8, 1);
    seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    seg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(paint(seg, k % 2 ? '#8a6a44' : '#7a5c3a', 0.05));
  }
  const top = at(1);
  for (let k = 0; k < 9; k++) {
    // A frond: a strip along a drooping arc, widest past its middle, pointed at the tip.
    const L = 2.6 + (k % 3) * 0.3, steps = 10, verts: number[] = [];
    const point = (t: number, side: number) => {
      const w = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * side;
      return new THREE.Vector3(t * L, 0.5 * t - 1.6 * t * t, w);
    };
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const c0 = point(t0, 0), c1 = point(t1, 0), l0 = point(t0, 1), l1 = point(t1, 1), r0 = point(t0, -1), r1 = point(t1, -1);
      // A shallow V: the leaflets hang a little below the rachis.
      for (const p of [l0, l1, r0, r1]) p.y -= 0.12 * Math.abs(p.z) / 0.42;
      verts.push(...c0.toArray(), ...l0.toArray(), ...c1.toArray(), ...c1.toArray(), ...l0.toArray(), ...l1.toArray());
      verts.push(...c0.toArray(), ...c1.toArray(), ...r0.toArray(), ...r0.toArray(), ...c1.toArray(), ...r1.toArray());
    }
    const frond = new THREE.BufferGeometry();
    frond.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    frond.rotateY((k / 9) * Math.PI * 2 + 0.3);
    frond.translate(top.x, top.y, top.z);
    parts.push(paint(frond, k % 2 ? '#2f8a38' : '#3f9a40', 0.12));
  }
  for (const [x, z] of [[0.18, 0], [-0.1, 0.15], [-0.05, -0.17]]) {
    const nut = new THREE.IcosahedronGeometry(0.16, 0);
    nut.translate(top.x + x, top.y - 0.22, top.z + z);
    parts.push(paint(nut, '#6b4a26'));
  }
  return mergeGeometries(parts)!;
}

/**
 * A big-leaved tropical plant about 1.6 m tall (banana / heliconia): a rosette of long blades on short
 * stalks, the inner ones upright, the outer ones arching out and drooping, each folded along its midrib.
 * Grey shading in the vertex colours (the instance colour is the green).
 */
function bigleafGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const leaves = 8, steps = 7;
  for (let k = 0; k < leaves; k++) {
    const outer = k / (leaves - 1);
    const rise = 1.25 - 0.75 * outer, length = 1.15 + 0.35 * Math.abs(Math.sin(k * 2.1)), width = 0.26 + 0.06 * Math.cos(k * 1.3);
    const stalk = 0.35 + 0.25 * (1 - outer);
    const base = new THREE.Vector3(Math.cos(rise) * stalk, Math.sin(rise) * stalk, 0);
    // Midrib: leaves the stalk at its angle, bends over under its weight.
    const rib = (t: number) => new THREE.Vector3(
      base.x + length * t * (0.35 + 0.65 * Math.cos(rise * (1 - 0.55 * t))),
      base.y + length * (Math.sin(rise) * t - (0.55 + 0.4 * outer) * t * t),
      0);
    const verts: number[] = [], shades: number[] = [];
    const edge = (t: number, side: number) => {
      const w = width * Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.7 * side, c = rib(t);
      return new THREE.Vector3(c.x, c.y - 0.35 * Math.abs(w), w);
    };
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const c0 = rib(t0), c1 = rib(t1);
      for (const side of [1, -1]) {
        const e0 = edge(t0, side), e1 = edge(t1, side);
        const tri = side > 0 ? [c0, e0, c1, c1, e0, e1] : [c0, c1, e0, e0, c1, e1];
        for (const v of tri) { verts.push(...v.toArray()); const g = 0.82 + 0.3 * (v.y / 1.6) + (Math.abs(v.z) < 1e-6 ? 0.12 : 0); shades.push(g, g, g); }
      }
    }
    // The stalk: a thin flat-shaded prism from the ground to the blade.
    const stem = new THREE.CylinderGeometry(0.025, 0.04, stalk, 4, 1, true);
    stem.deleteAttribute('uv');
    stem.translate(0, stalk / 2, 0);
    stem.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), base.clone().normalize()));
    const stalkGeometry = shade(stem, () => 0.95);
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
    blade.computeVertexNormals();
    for (const g of [blade, stalkGeometry]) {
      g.rotateY(k * 2.399 + 0.2); // golden angle: no two leaves overlap
      parts.push(g);
    }
  }
  return mergeGeometries(parts)!;
}

/** Ground cover about 0.4 m across and 0.11 m high: five leaflets lying out, three standing up in the middle. */
function sproutGeometry(): THREE.BufferGeometry {
  const verts: number[] = [];
  const leaflet = (yaw: number, length: number, lift: number, width: number) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (along: number, side: number, y: number) => [along * c - side * s, y, along * s + side * c];
    const base = at(0, 0, 0.01), left = at(length * 0.45, width, lift * 0.6), right = at(length * 0.45, -width, lift * 0.6), tip = at(length, 0, lift);
    verts.push(...base, ...left, ...tip, ...base, ...tip, ...right);
  };
  for (let k = 0; k < 5; k++) leaflet(k * 1.2566 + 0.3, 0.19, 0.06, 0.05);
  for (let k = 0; k < 3; k++) leaflet(k * 2.094, 0.1, 0.11, 0.035);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return shade(g, (p) => 0.85 + 2 * p.y);
}

/** Like `shade`, with a colour (r, g, b) per vertex: the instance colour multiplies it. */
function shadeRgb(geometry: THREE.BufferGeometry, f: (p: THREE.Vector3, n: THREE.Vector3) => [number, number, number]): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i); colors.set(f(p, n), i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A broken stone column about 3 m tall: a square plinth, a fluted shaft snapped off unevenly, moss at its foot. */
function columnGeometry(): THREE.BufferGeometry {
  const plinth = new THREE.BoxGeometry(0.95, 0.28, 0.95);
  plinth.translate(0, 0.14, 0);
  const H = 2.7, sides = 12;
  const shaft = new THREE.CylinderGeometry(0.31, 0.36, H, sides, 3);
  const pos = shaft.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x);
    // Flutes: every other edge a little in; the top ring broken off at an angle with a jagged edge.
    const flute = Math.round(((a + Math.PI) / (2 * Math.PI)) * sides) % 2 ? 0.93 : 1;
    const top = y > H / 2 - 1e-3 ? -0.55 * (0.5 + 0.5 * Math.sin(a)) - 0.12 * Math.abs(Math.sin(a * 5.3)) : 0;
    pos.setXYZ(i, x * flute, y + top, z * flute);
  }
  shaft.translate(0, 0.28 + H / 2, 0);
  const g = mergeGeometries([plinth.toNonIndexed(), shaft.toNonIndexed()].map((x) => { x.deleteAttribute('uv'); return x; }))!;
  return shadeRgb(g, (p, n) => {
    const moss = Math.max(0, 1 - p.y / 1.1) * (0.6 + 0.4 * Math.sin(Math.atan2(p.z, p.x) * 3 + p.y * 4));
    const light = (n.y > 0.7 ? 1.08 : 0.9) + 0.05 * Math.sin(p.y * 9);
    return [light * (1 - 0.35 * moss), light * (1 - 0.08 * moss), light * (1 - 0.45 * moss)];
  });
}

/** A wide, gentle hill (radius 1, about 0.3 high): a smooth bump over a radial grid, its rim sunk well below (no gap over water or past the ground). */
function hillGeometry(): THREE.BufferGeometry {
  const rings = 7, spokes = 16;
  const at = (ring: number, spoke: number) => {
    const r = ring / rings, a = (spoke / spokes) * Math.PI * 2;
    const bump = Math.cos((Math.PI / 2) * r) ** 2 * (1 + 0.18 * Math.sin(a * 3 + 1.1) * r);
    return new THREE.Vector3(r * Math.cos(a), ring === rings ? -0.3 : 0.3 * bump - 0.04, r * Math.sin(a));
  };
  const verts: number[] = [];
  for (let ring = 0; ring < rings; ring++) for (let spoke = 0; spoke < spokes; spoke++) {
    const a = at(ring, spoke), b = at(ring + 1, spoke), c = at(ring + 1, spoke + 1), d = at(ring, spoke + 1);
    if (ring > 0) verts.push(...a.toArray(), ...d.toArray(), ...b.toArray());
    verts.push(...b.toArray(), ...d.toArray(), ...c.toArray());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return shade(g, (p) => 0.88 + 0.5 * Math.max(0, p.y));
}

/** A little flower lying in the grass (0.25 m across): five petals round a yellow heart; the petals take the instance colour. */
function blossomGeometry(): THREE.BufferGeometry {
  const verts: number[] = [], colors: number[] = [];
  const push = (rgb: number[], ...pts: number[][]) => { for (const p of pts) { verts.push(...p); colors.push(...rgb); } };
  const h = 0.07;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), side = 0.045;
    const at = (r: number, w: number, y: number) => [r * c - w * s, y, r * s + w * c];
    push([1.05, 1.05, 1.05], at(0.02, 0, h), at(0.07, side, h + 0.01), at(0.12, 0, h - 0.01));
    push([0.95, 0.95, 0.95], at(0.02, 0, h), at(0.12, 0, h - 0.01), at(0.07, -side, h + 0.01));
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2, b = ((k + 1) / 3) * Math.PI * 2;
    push([1.25, 1.05, 0.3], [0, h + 0.025, 0], [0.035 * Math.cos(a), h + 0.012, 0.035 * Math.sin(a)], [0.035 * Math.cos(b), h + 0.012, 0.035 * Math.sin(b)]);
  }
  // A short stalk so it does not float above the relief's gentle slopes.
  push([0.45, 0.7, 0.35], [0.008, 0, 0], [-0.008, 0, 0], [0, h, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Horizontal reach of a model round its origin (its base), with room for the props' tilt. */
function reachOf(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  let r = 0;
  for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  return r * 1.1;
}

/** A giant rainforest trunk (ARENA_TRUNK_HEIGHT_M tall) flaring into buttress roots (sapopemas) at its foot. */
function trunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.7, 1.05, ARENA_TRUNK_HEIGHT_M, 10, 8);
  const pos = trunk.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const s = 1 + 0.08 * jitter(Math.round(pos.getX(i) * 100), Math.round(pos.getY(i) * 10), Math.round(pos.getZ(i) * 100), 4);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i), pos.getZ(i) * s);
  }
  trunk.translate(0, ARENA_TRUNK_HEIGHT_M / 2, 0);
  parts.push(trunk.toNonIndexed());
  for (let k = 0; k < 6; k++) {
    // A fin: tall against the trunk, sweeping down and out to the ground.
    const reach = 2.6 + 1.4 * Math.abs(Math.sin(k * 2.3)), rise = 3.5 + 2 * Math.abs(Math.cos(k * 1.7));
    const shape = new THREE.Shape();
    shape.moveTo(0.5, 0); shape.lineTo(reach, 0);
    shape.quadraticCurveTo(1.4, 0.35, 0.8, rise); shape.lineTo(0.5, rise + 0.3); shape.lineTo(0.5, 0);
    const fin = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: false, curveSegments: 4 });
    fin.translate(0, 0, -0.16);
    fin.rotateY((k / 6) * Math.PI * 2 + 0.4 * Math.sin(k * 3.1));
    fin.deleteAttribute('uv');
    parts.push(fin.index ? fin.toNonIndexed() : fin);
  }
  for (const p of parts) p.deleteAttribute('uv');
  const g = mergeGeometries(parts)!;
  return shade(g, (p) => 0.78 + 0.22 * Math.min(1, p.y / 8) + 0.06 * Math.sin(Math.atan2(p.z, p.x) * 9));
}

/** A region's props: build once, then `update` every frame with the travel and the region's relief. */
export class ArenaProps {
  readonly group = new THREE.Group();
  private readonly meshes: Array<{ mesh: THREE.InstancedMesh; items: ArenaPropInstance[] }> = [];
  // Double-sided: fronds and leaves are single sheets.
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** Per kind: how far the unit-size model reaches round its base (horizontal, metres). */
  private readonly reach = new Map<ArenaPropKind, number>();
  private readonly shore: number;
  private lastTravelled = Number.NaN;
  private lastYaw = Number.NaN;
  private disposed = false;
  /** Settles once the modelled kinds are in (or failed to load: the region is drawn without them). */
  readonly loaded: Promise<void>;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  /** `layerDistance`: the painted layer props must stay in front of (the near layer, or the far one where there is none). */
  constructor(region: ArenaRegionId, private readonly relief: number, private readonly layerDistance = ARENA_NEAR_LAYER_DISTANCE_M) {
    this.group.name = `arena:props:${region}`;
    this.shore = arenaShore(region);
    const byKind = new Map<ArenaPropKind, ArenaPropInstance[]>();
    for (const item of arenaPropLayout(region)) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    const modelled = [...byKind].filter(([kind]) => MODEL_PROPS.has(kind));
    for (const [kind, items] of byKind) {
      if (MODEL_PROPS.has(kind)) continue;
      const geometry = geometryOf(kind);
      this.geometries.push(geometry);
      this.addKind(kind, geometry, items);
    }
    this.loaded = !modelled.length ? Promise.resolve() : loadModelGeometries().then((geometries) => {
      if (this.disposed) return;
      for (const [kind, items] of modelled) { const g = geometries.get(kind); if (g) this.addKind(kind, g, items); }
      // Place the new kinds where the others are.
      const travelled = this.lastTravelled, yaw = this.lastYaw;
      this.lastTravelled = Number.NaN;
      if (Number.isFinite(travelled)) this.update(travelled, yaw);
    }).catch(() => undefined);
  }

  private addKind(kind: ArenaPropKind, geometry: THREE.BufferGeometry, items: ArenaPropInstance[]): void {
    this.reach.set(kind, reachOf(geometry));
    const mesh = new THREE.InstancedMesh(geometry, this.material, items.length);
    mesh.name = `arena:props:${kind}`;
    mesh.frustumCulled = false;
    const color = new THREE.Color();
    items.forEach((item, i) => mesh.setColorAt(i, color.set(item.color)));
    this.group.add(mesh);
    this.meshes.push({ mesh, items });
  }

  get instanceCount(): number { return this.meshes.reduce((n, m) => n + m.items.length, 0); }

  /** How far a unit-size prop of `kind` reaches round its base (tests). */
  reachOf(kind: ArenaPropKind): number { return this.reach.get(kind) ?? 0; }

  /**
   * Place every prop for `travelled` metres (scenery-local x: the scenery group follows the camera) and
   * the camera yaw (radians): props shrink away before they cross the painted near layer, which turns with it.
   */
  update(travelled: number, yawRad = 0): void {
    if (Math.abs(travelled - this.lastTravelled) < 1e-4 && Math.abs(yawRad - this.lastYaw) < 1e-5) return;
    this.lastTravelled = travelled;
    this.lastYaw = yawRad;
    for (const { mesh, items } of this.meshes) {
      const reach = this.reach.get(items[0].kind) ?? 0;
      items.forEach((item, i) => {
        const x = propLocalX(item.u, travelled);
        const y = terrainHeight(x + travelled, item.z, this.relief, this.shore);
        this.p.set(x, y, item.z);
        this.q.setFromEuler(this.e.set(item.tilt * 0.5, item.yaw, item.kind === 'log' || item.kind === 'twig' ? 0 : item.tilt));
        this.s.setScalar(item.size * nearLayerScale(x, item.z, reach * item.size, yawRad, this.layerDistance));
        mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    for (const { mesh } of this.meshes) mesh.dispose();
  }
}
