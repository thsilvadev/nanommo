import * as THREE from 'three';
import { ArenaActorView, ArenaTint } from './arena-actor-views';
import type { ArenaActorFrame } from './arena-actions';
import type { TownCharacterFactory } from '../town-scene/town-character';

describe('ArenaTint (hit flash and exit fade)', () => {
  function model() {
    const material = new THREE.MeshStandardMaterial({ color: '#888888', emissive: '#335577', transparent: true, opacity: 0.6 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const group = new THREE.Group();
    group.add(mesh);
    return { group, mesh, material };
  }

  it('does not touch materials while there is nothing to show', () => {
    const { group, mesh, material } = model();
    new ArenaTint().apply(group, '#000000', 0, 1);
    expect(mesh.material).toBe(material);
  });

  it('flashes a copy, never the shared material, adding to its own glow', () => {
    const { group, mesh, material } = model();
    const tint = new ArenaTint();
    tint.apply(group, '#ffffff', 1, 1);
    const copy = mesh.material as THREE.MeshStandardMaterial;
    expect(copy).not.toBe(material);
    expect(copy.emissive.r).toBeGreaterThan(material.emissive.r);
    expect(material.emissive.getHexString()).toBe('335577');
  });

  it('restores the authored emissive, transparency and opacity after the flash', () => {
    const { group, mesh } = model();
    const tint = new ArenaTint();
    tint.apply(group, '#ff0000', 1, 1);
    tint.apply(group, '#000000', 0, 1);
    const m = mesh.material as THREE.MeshStandardMaterial;
    expect(m.emissive.getHexString()).toBe('335577');
    expect(m.transparent).toBeTrue();
    expect(m.opacity).toBeCloseTo(0.6, 6);
  });

  it('fades relative to the authored opacity and keeps blended materials blended', () => {
    const { group, mesh } = model();
    const tint = new ArenaTint();
    tint.apply(group, '#000000', 0, 0.5);
    const m = mesh.material as THREE.MeshStandardMaterial;
    expect(m.opacity).toBeCloseTo(0.3, 6);
    expect(m.transparent).toBeTrue();
  });

  it('an opaque material becomes transparent only while fading', () => {
    const material = new THREE.MeshStandardMaterial({ color: '#888888' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const tint = new ArenaTint();
    tint.apply(mesh, '#000000', 0, 0.5);
    expect((mesh.material as THREE.Material).transparent).toBeTrue();
    tint.apply(mesh, '#000000', 0, 1);
    expect((mesh.material as THREE.Material).transparent).toBeFalse();
    expect((mesh.material as THREE.Material).opacity).toBe(1);
  });
});

describe('ArenaActorView flyers', () => {
  const frame = (over: Partial<ArenaActorFrame> = {}): ArenaActorFrame => ({
    id: 'bee', column: 5, row: 5, facing: -1, moving: null, hp: 10, sp: 0, statuses: [], statusSinceMs: {}, deadAtMs: null, fleeing: null,
    anim: { base: 'CombatIdle' }, cast: null, projectile: null, ...over,
  });
  const view = (monsterId: string) => new ArenaActorView(
    { id: 'bee', team: 'b', kind: 'monster', name: 'Bee', look: null, monsterId },
    null as unknown as TownCharacterFactory, new Promise(() => undefined),
  );

  it('a bee flies 1.2 m up (HUD and aim follow it), its shadow stays on the ground, and it lands once dead', () => {
    const bee = view('mon_mutantbee');
    const walker = view('mon_gravelhorn');
    bee.update(frame(), 1000, []);
    walker.update(frame(), 1000, []);
    expect(bee.headHeight() - walker.headHeight()).toBeCloseTo(1.2, 6);
    expect(bee.aimHeight() - walker.aimHeight()).toBeCloseTo(1.2, 6);
    const shadow = bee.object3d.children.find((o) => (o as any).geometry?.type === 'PlaneGeometry')!;
    expect(shadow.position.y).toBeLessThan(0.05);
    bee.update(frame({ deadAtMs: 1000, anim: { base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: 1000, speed: 1 } } }), 5000, []);
    expect(bee.headHeight()).toBeCloseTo(walker.headHeight(), 6);
    bee.dispose(); walker.dispose();
  });
});
