/**
 * The arena's 3D ground props (rocks, bushes, logs, twigs, leaves, pebbles):
 * one InstancedMesh per kind, laid out by arena-prop-layout, sitting on the
 * terrain and scrolled with the ground. Low-poly, flat-shaded, coloured per
 * instance (and per vertex for shading such as log ends and bush bottoms).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArenaRegionId } from './arena-region';
import { arenaPropLayout, propLocalX, type ArenaPropInstance, type ArenaPropKind } from './arena-prop-layout';
import { terrainHeight } from './arena-terrain';

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
export function nearLayerScale(x: number, z: number, reach: number, yawRad: number): number {
  const along = -x * Math.sin(yawRad) - z * Math.cos(yawRad);
  const room = reach + NEAR_LAYER_EASE_M * Math.abs(Math.sin(yawRad));
  return Math.min(1, Math.max(0, (ARENA_NEAR_LAYER_DISTANCE_M - along) / Math.max(room, 1e-6)));
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

/** Horizontal reach of a model round its origin (its base), with room for the props' tilt. */
function reachOf(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  let r = 0;
  for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  return r * 1.1;
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
  private lastTravelled = Number.NaN;
  private lastYaw = Number.NaN;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(region: ArenaRegionId, private readonly relief: number) {
    this.group.name = `arena:props:${region}`;
    const byKind = new Map<ArenaPropKind, ArenaPropInstance[]>();
    for (const item of arenaPropLayout(region)) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    const color = new THREE.Color();
    for (const [kind, items] of byKind) {
      const geometry = geometryOf(kind);
      this.geometries.push(geometry);
      this.reach.set(kind, reachOf(geometry));
      const mesh = new THREE.InstancedMesh(geometry, this.material, items.length);
      mesh.name = `arena:props:${kind}`;
      mesh.frustumCulled = false;
      items.forEach((item, i) => mesh.setColorAt(i, color.set(item.color)));
      this.group.add(mesh);
      this.meshes.push({ mesh, items });
    }
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
        const y = terrainHeight(x + travelled, item.z, this.relief);
        this.p.set(x, y, item.z);
        this.q.setFromEuler(this.e.set(item.tilt * 0.5, item.yaw, item.kind === 'log' || item.kind === 'twig' ? 0 : item.tilt));
        this.s.setScalar(item.size * nearLayerScale(x, item.z, reach * item.size, yawRad));
        mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    for (const { mesh } of this.meshes) mesh.dispose();
  }
}
