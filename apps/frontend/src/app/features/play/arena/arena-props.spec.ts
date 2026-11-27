import * as THREE from 'three';
import { ARENA_NEAR_LAYER_DISTANCE_M, ArenaProps, nearLayerScale } from './arena-props';

describe('ArenaProps near the painted near layer', () => {
  const yaw = (70 * Math.PI) / 180;
  /** Distance along the view (scenery-local) of a point for a camera yaw, as the turning layer sees it. */
  const along = (x: number, z: number, y: number) => -x * Math.sin(y) - z * Math.cos(y);

  it('from the front only a prop that would cross the layer shrinks, just enough to stay in front of it', () => {
    expect(nearLayerScale(0, -18, 1, 0)).toBe(1);
    expect(nearLayerScale(60, -20, 1.5, 0)).toBe(1);
    const s = nearLayerScale(0, -21.5, 1, 0);
    expect(s).toBeCloseTo(0.5, 6);
    expect(21.5 + s * 1).toBeCloseTo(ARENA_NEAR_LAYER_DISTANCE_M, 6); // its far edge touches the layer
    expect(nearLayerScale(0, -23, 1, 0)).toBe(0); // base behind the layer: gone
  });

  it('turned to the orbit limit, props along the view ease out whole and never reach past the layer', () => {
    for (const x of [-10, -18, -21, -24, -40, -80]) {
      const reach = 1.2, s = nearLayerScale(x, -16, reach, yaw);
      expect(s).withContext(`x ${x}`).toBeGreaterThanOrEqual(0);
      expect(s).withContext(`x ${x}`).toBeLessThanOrEqual(1);
      if (s > 0) expect(along(x, -16, yaw) + s * reach).withContext(`x ${x}`).toBeLessThanOrEqual(ARENA_NEAR_LAYER_DISTANCE_M + 1e-9);
    }
    expect(nearLayerScale(-10, -16, 1.2, yaw)).toBe(1);
    expect(nearLayerScale(-40, -16, 1.2, yaw)).toBe(0);
    expect(nearLayerScale(40, -16, 1.2, yaw)).toBe(1); // behind the camera's side: untouched
    expect(nearLayerScale(40, -16, 1.2, -yaw)).toBe(0); // mirrored
    // The scale falls continuously while the camera turns (no pop between two nearby angles).
    let last = 1;
    for (let deg = 0; deg <= 70; deg += 0.5) {
      const s = nearLayerScale(-22, -16, 1, (deg * Math.PI) / 180);
      expect(last - s).withContext(`${deg}°`).toBeLessThan(0.15);
      expect(s).toBeLessThanOrEqual(last + 1e-12);
      last = s;
    }
    expect(last).toBe(0);
  });

  it('the instances shrink about their base with the yaw, and grow back when the camera turns back', () => {
    const props = new ArenaProps('green_grounds', 1);
    expect(props.reachOf('rock')).toBeGreaterThan(0.5);
    const scales = () => {
      const out: number[] = [], m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      props.group.children.forEach((c) => { const mesh = c as THREE.InstancedMesh; for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); m.decompose(p, q, s); out.push(s.x); } });
      return out;
    };
    props.update(0, 0);
    const front = scales();
    props.update(0, yaw);
    const turned = scales();
    expect(turned.filter((s) => s < 1e-6).length).toBeGreaterThan(front.filter((s) => s < 1e-6).length + 20);
    props.update(0, 0);
    expect(scales()).toEqual(front);
    props.dispose();
  });
});
