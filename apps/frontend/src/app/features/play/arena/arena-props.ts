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
      return shade(new THREE.ConeGeometry(0.3, 4, 6), () => 1);
  }
}

/** A region's props: build once, then `update` every frame with the travel and the region's relief. */
export class ArenaProps {
  readonly group = new THREE.Group();
  private readonly meshes: Array<{ mesh: THREE.InstancedMesh; items: ArenaPropInstance[] }> = [];
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly geometries: THREE.BufferGeometry[] = [];
  private lastTravelled = Number.NaN;
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
      const mesh = new THREE.InstancedMesh(geometry, this.material, items.length);
      mesh.name = `arena:props:${kind}`;
      mesh.frustumCulled = false;
      items.forEach((item, i) => mesh.setColorAt(i, color.set(item.color)));
      this.group.add(mesh);
      this.meshes.push({ mesh, items });
    }
  }

  get instanceCount(): number { return this.meshes.reduce((n, m) => n + m.items.length, 0); }

  /** Place every prop for `travelled` metres (scenery-local x: the scenery group follows the camera). */
  update(travelled: number): void {
    if (Math.abs(travelled - this.lastTravelled) < 1e-4) return;
    this.lastTravelled = travelled;
    for (const { mesh, items } of this.meshes) {
      items.forEach((item, i) => {
        const x = propLocalX(item.u, travelled);
        const y = terrainHeight(x + travelled, item.z, this.relief);
        this.p.set(x, y, item.z);
        this.q.setFromEuler(this.e.set(item.tilt * 0.5, item.yaw, item.kind === 'log' || item.kind === 'twig' ? 0 : item.tilt));
        this.s.setScalar(item.size);
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
