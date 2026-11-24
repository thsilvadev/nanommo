/**
 * Smashing Spree (Quebra-Quebra) vases in the town scene: one InstancedMesh per
 * vase shape (≤ 3 draw calls for 500 vases), plus the shards a vase breaks into.
 * Lazy like the rest of the town runtime (three.js stays out of the main bundle).
 */
import * as THREE from 'three';
import { Mulberry32, mulberry32Seed, type TownEventVase } from '@nanommo/shared';

const VARIANTS = 3;
const VASE_SCALE = 1.2;
const SEGMENTS = 22;
const HOVER_TINT = new THREE.Color(1.55, 1.35, 1.05);
const WHITE = new THREE.Color(1, 1, 1);
const HIDDEN = new THREE.Matrix4().compose(new THREE.Vector3(0, -50, 0), new THREE.Quaternion(), new THREE.Vector3(1e-4, 1e-4, 1e-4));

/**
 * Lathe profiles (radius, height): tall amphora, round jar, short wide pot.
 * After the rim the wall folds back inside and down to an inner floor, so an
 * open neck shows a dark interior instead of the ground.
 */
const PROFILES: Array<Array<[number, number]>> = [
  [[0, 0], [0.13, 0], [0.19, 0.04], [0.25, 0.18], [0.27, 0.31], [0.23, 0.47], [0.13, 0.59], [0.1, 0.65], [0.135, 0.71], [0.145, 0.75], [0.115, 0.745], [0.085, 0.66], [0.1, 0.5], [0.06, 0.1], [0, 0.08]],
  [[0, 0], [0.15, 0], [0.24, 0.07], [0.3, 0.22], [0.29, 0.36], [0.21, 0.47], [0.17, 0.51], [0.2, 0.55], [0.17, 0.56], [0.145, 0.49], [0.2, 0.3], [0.1, 0.08], [0, 0.07]],
  [[0, 0], [0.19, 0], [0.29, 0.07], [0.33, 0.19], [0.31, 0.31], [0.26, 0.37], [0.29, 0.42], [0.26, 0.43], [0.225, 0.36], [0.24, 0.2], [0.12, 0.07], [0, 0.06]],
];
/** Index of the outer rim point of each profile (points after it are inside the vase). */
const RIM_INDEX = [9, 7, 6];

const CLAY = new THREE.Color('#b9572d');
const CLAY_DARK = new THREE.Color('#87391c');
const BAND = new THREE.Color('#3f190d');
const CREAM = new THREE.Color('#ecd2a0');
const RIM = new THREE.Color('#d98352');
const INSIDE = new THREE.Color('#2a1209');

function heightOf(variant: number): number { return Math.max(...PROFILES[variant].map((p) => p[1])); }

/**
 * Painted terracotta by height `f` (0 foot, 1 rim) and around-the-vase `u` (0–1):
 * dark foot, cream pinstripes, a dark band with cream dots, a warm rim.
 */
function paint(f: number, u: number, out: THREE.Color): THREE.Color {
  if (f > 0.93) return out.copy(RIM);
  if (f > 0.5 && f < 0.63) {
    const dot = f > 0.54 && f < 0.59 && Math.round(u * 22) % 2 === 0;
    return out.copy(dot ? CREAM : BAND);
  }
  if ((f > 0.44 && f < 0.47) || (f > 0.66 && f < 0.69)) return out.copy(CREAM);
  if (f < 0.1) return out.copy(CLAY_DARK);
  // Slightly darker low on the belly, warmer up top: reads as rounded under a top light.
  return out.copy(CLAY_DARK).lerp(CLAY, Math.min(1, f * 2.2)).lerp(RIM, Math.max(0, f - 0.7) * 0.8);
}

export function vaseGeometry(variant: number): THREE.LatheGeometry {
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  const profile = PROFILES[v];
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), SEGMENTS);
  const h = heightOf(v);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const j = i % profile.length;
    if (j > RIM_INDEX[v]) c.copy(INSIDE).lerp(BAND, Math.min(1, position.getY(i) / h));
    else paint(position.getY(i) / h, uv.getX(i), c);
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function vaseMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02, side: THREE.DoubleSide, transparent: true, opacity: 1 });
}

interface Slot { vase: TownEventVase; variant: number; slot: number }

export class TownVases {
  private readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private readonly index = new Map<string, Slot>();
  private readonly all = new Map<string, Slot>();
  private hovered: string | null = null;
  /** Per-vase clay shade (no two vases quite the same colour). */
  private readonly tints = new Map<string, THREE.Color>();

  constructor(scene: THREE.Scene) {
    this.group.name = 'town-vases';
    scene.add(this.group);
  }

  /**
   * Show these vases. When they are a subset of what is shown (vases broke meanwhile,
   * a resync), the missing ones are hidden in place; otherwise everything is rebuilt.
   */
  set(vases: TownEventVase[] | null): void {
    if (!vases || !vases.length) { this.clear(); return; }
    if (this.all.size && vases.every((v) => this.all.has(v.id))) {
      const keep = new Set(vases.map((v) => v.id));
      for (const id of [...this.index.keys()]) if (!keep.has(id)) { this.hide(id); this.hideInstance(id); }
      return;
    }
    this.clear();
    const byVariant: TownEventVase[][] = Array.from({ length: VARIANTS }, () => []);
    for (const v of vases) byVariant[((v.variant % VARIANTS) + VARIANTS) % VARIANTS].push(v);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(VASE_SCALE, VASE_SCALE, VASE_SCALE);
    byVariant.forEach((list, variant) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(vaseGeometry(variant), vaseMaterial(), list.length);
      mesh.name = `town-vases:${variant}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const ids: string[] = [];
      list.forEach((vase, slot) => {
        mesh.setMatrixAt(slot, m.compose(new THREE.Vector3(vase.x, 0, vase.z), q.setFromAxisAngle(up, vase.rot), scale));
        const seed = Math.abs(mulberry32Seed(`tint:${vase.id}`)) % 1000 / 1000;
        const tint = new THREE.Color(0.86 + seed * 0.2, 0.84 + seed * 0.18, 0.82 + ((seed * 7) % 1) * 0.16);
        this.tints.set(vase.id, tint);
        mesh.setColorAt(slot, tint);
        ids.push(vase.id);
        const entry = { vase, variant, slot };
        this.index.set(vase.id, entry);
        this.all.set(vase.id, entry);
      });
      mesh.userData['ids'] = ids;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
  }

  pickTargets(): THREE.Object3D[] { return this.meshes; }

  /** Vase id of a ray hit on one of the vase meshes (null when that vase already broke). */
  idOf(hit: THREE.Intersection): string | null {
    const ids = hit.object.userData['ids'] as string[] | undefined;
    const id = ids && hit.instanceId !== undefined ? ids[hit.instanceId] : undefined;
    return id && this.index.has(id) ? id : null;
  }

  positionOf(id: string): [number, number] | null {
    const slot = this.index.get(id);
    return slot ? [slot.vase.x, slot.vase.z] : null;
  }

  variantOf(id: string): number { return this.all.get(id)?.variant ?? 0; }
  rotationOf(id: string): number { return this.all.get(id)?.vase.rot ?? 0; }
  count(): number { return this.index.size; }

  /** Stops picking and position lookups at once (the vase is broken); the model may stay until the swing lands. */
  hide(id: string): void {
    this.index.delete(id);
    if (this.hovered === id) this.setHovered(null);
  }

  /** Removes the vase model from view. */
  hideInstance(id: string): void {
    const slot = this.all.get(id);
    if (!slot) return;
    const mesh = this.meshes.find((m) => m.name === `town-vases:${slot.variant}`);
    if (!mesh) return;
    mesh.setMatrixAt(slot.slot, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
  }

  setHovered(id: string | null): void {
    if (id === this.hovered) return;
    for (const [target, hover] of [[this.hovered, false], [id, true]] as const) {
      const slot = target ? this.all.get(target) : undefined;
      const mesh = slot ? this.meshes.find((m) => m.name === `town-vases:${slot.variant}`) : undefined;
      if (!target || !slot || !mesh) continue;
      const base = this.tints.get(target) ?? WHITE;
      mesh.setColorAt(slot.slot, hover ? base.clone().multiply(HOVER_TINT) : base);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.hovered = id && this.index.has(id) ? id : null;
  }

  setOpacity(opacity: number): void {
    for (const mesh of this.meshes) (mesh.material as THREE.MeshStandardMaterial).opacity = opacity;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.meshes = [];
    this.index.clear();
    this.all.clear();
    this.tints.clear();
    this.hovered = null;
  }
}

export interface VaseShard { mesh: THREE.Mesh; start: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3 }

/**
 * 12–16 curved clay shards, laid out around the vase wall, flying outwards and up.
 * Seeded by the vase id: every client sees the same pieces fly the same way.
 */
export function buildShards(vaseId: string, variant: number, material?: THREE.Material): VaseShard[] {
  const rng = new Mulberry32(mulberry32Seed(`shards:${vaseId}`));
  const h = heightOf(((variant % VARIANTS) + VARIANTS) % VARIANTS) * VASE_SCALE;
  const count = 12 + Math.floor(rng.next() * 5);
  const shardMaterial = material ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, transparent: true });
  const c = new THREE.Color();
  const shards: VaseShard[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng.next() * 0.4;
    const y = 0.05 + rng.next() * h * 0.85;
    const radius = 0.22 * VASE_SCALE;
    const size = 0.09 + rng.next() * 0.09;
    // A small bent quad (two triangles), coloured like the wall it came from.
    const bend = 0.02 + rng.next() * 0.02;
    const pts = [[-size, -size * 0.8, 0], [size, -size * 0.6, bend], [size * 0.7, size * 0.8, 0], [-size * 0.8, size * 0.7, bend]];
    const positions = new Float32Array([...pts[0], ...pts[1], ...pts[2], ...pts[0], ...pts[2], ...pts[3]]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colors = new Float32Array(18);
    paint(y / h, i / count, c);
    // Outer face clay, broken edges a touch lighter.
    for (let k = 0; k < 6; k++) (k % 3 === 1 ? c.clone().lerp(CREAM, 0.25) : c).toArray(colors, k * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, shardMaterial);
    const out = 1.3 + rng.next() * 1.9;
    shards.push({
      mesh,
      start: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
      velocity: new THREE.Vector3(Math.cos(angle) * out, 1.8 + rng.next() * 2.4, Math.sin(angle) * out),
      spin: new THREE.Vector3((rng.next() - 0.5) * 16, (rng.next() - 0.5) * 16, (rng.next() - 0.5) * 16),
    });
  }
  return shards;
}
