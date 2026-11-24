import * as THREE from 'three';
import type { TownEventVase } from '@nanommo/shared';
import { TownVases, buildShards } from './town-vases';

const many = (n: number): TownEventVase[] => Array.from({ length: n }, (_, i) => ({ id: `v${String(i).padStart(3, '0')}`, x: (i % 20) * 2 + 1, z: Math.floor(i / 20) * 2 + 1, rot: i * 0.3, variant: i % 3 }));

describe('TownVases', () => {
  let scene: THREE.Scene;
  let vases: TownVases;
  beforeEach(() => { scene = new THREE.Scene(); vases = new TownVases(scene); });
  afterEach(() => vases.dispose());

  it('draws 200 vases with at most three instanced meshes', () => {
    vases.set(many(200));
    const meshes = vases.pickTargets() as THREE.InstancedMesh[];
    expect(meshes.length).toBeLessThanOrEqual(3);
    expect(meshes.every(m => m.isInstancedMesh)).toBeTrue();
    expect(meshes.reduce((sum, m) => sum + m.count, 0)).toBe(200);
    expect(vases.count()).toBe(200);
  });

  it('maps a ray hit back to the vase id', () => {
    vases.set(many(3));
    const target = many(3)[1];
    const ray = new THREE.Raycaster(new THREE.Vector3(target.x, 5, target.z), new THREE.Vector3(0, -1, 0));
    scene.updateMatrixWorld(true);
    const hit = ray.intersectObjects(vases.pickTargets(), false)[0];
    expect(hit).toBeDefined();
    expect(vases.idOf(hit)).toBe(target.id);
  });

  it('hide() removes a vase from picking and position lookups', () => {
    vases.set(many(3));
    const target = many(3)[0];
    expect(vases.positionOf(target.id)).toEqual([target.x, target.z]);
    vases.hide(target.id);
    expect(vases.positionOf(target.id)).toBeNull();
    const ray = new THREE.Raycaster(new THREE.Vector3(target.x, 5, target.z), new THREE.Vector3(0, -1, 0));
    scene.updateMatrixWorld(true);
    const hit = ray.intersectObjects(vases.pickTargets(), false)[0];
    expect(hit ? vases.idOf(hit) : null).not.toBe(target.id);
    expect(vases.count()).toBe(2);
  });

  it('set(null) removes everything and disposes the geometries', () => {
    vases.set(many(5));
    const geometries = (vases.pickTargets() as THREE.Mesh[]).map(m => m.geometry);
    const disposed = geometries.map(g => spyOn(g, 'dispose').and.callThrough());
    vases.set(null);
    expect(vases.pickTargets().length).toBe(0);
    expect(scene.children.filter(c => c.name === 'town-vases').every(g => g.children.length === 0)).toBeTrue();
    expect(disposed.every(s => s.calls.count() > 0)).toBeTrue();
  });

  it('shards are deterministic per vase id, 12 to 16 of them', () => {
    const a = buildShards('v007', 0);
    const b = buildShards('v007', 0);
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(a.length).toBeLessThanOrEqual(16);
    expect(a.map(s => s.velocity.toArray())).toEqual(b.map(s => s.velocity.toArray()));
    expect(buildShards('v008', 0).map(s => s.velocity.x)).not.toEqual(a.map(s => s.velocity.x));
    for (const s of a) { s.mesh.geometry.dispose(); }
    for (const s of b) { s.mesh.geometry.dispose(); }
  });
});
