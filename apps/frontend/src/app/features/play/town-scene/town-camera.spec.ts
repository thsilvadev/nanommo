import * as THREE from 'three';
import type { TownSceneDef } from '@nanommo/shared';
import { TOWN_CAMERA_MAX_DISTANCE, TOWN_CAMERA_MIN_DISTANCE, TownCamera } from './town-camera';

const def = { mapId: 'map_test', size: { w: 72, h: 72 } } as TownSceneDef;

describe('TownCamera', () => {
  const viewDir = (camera: TownCamera) => camera.camera.getWorldDirection(new THREE.Vector3());

  it('uses a low FOV, a fixed 55° pitch and a fixed 45° yaw', () => {
    const cam = new TownCamera(800, 600, def);
    expect(cam.camera.fov).toBe(30);
    const dir = viewDir(cam);
    expect(Math.asin(-dir.y) * 180 / Math.PI).toBeCloseTo(55, 5);
    expect(Math.atan2(-dir.x, -dir.z) * 180 / Math.PI).toBeCloseTo(45, 5);
  });

  it('clamps the zoom distance to [18, 70]', () => {
    expect([TOWN_CAMERA_MIN_DISTANCE, TOWN_CAMERA_MAX_DISTANCE]).toEqual([18, 70]);
    const cam = new TownCamera(800, 600, def);
    for (let i = 0; i < 50; i++) cam.zoomBy(0.5);
    expect(cam.distance).toBe(18);
    for (let i = 0; i < 50; i++) cam.zoomBy(2);
    expect(cam.distance).toBe(70);
  });

  it('pans but keeps the centre inside the town rectangle', () => {
    const cam = new TownCamera(800, 600, def);
    cam.centerOn(36, 36);
    for (let i = 0; i < 200; i++) cam.pan(400, 0);
    for (let i = 0; i < 200; i++) cam.pan(0, 400);
    const t = cam.target;
    expect(t.x).toBeGreaterThanOrEqual(0); expect(t.x).toBeLessThanOrEqual(72);
    expect(t.z).toBeGreaterThanOrEqual(0); expect(t.z).toBeLessThanOrEqual(72);
    cam.centerOn(-50, 500);
    expect([cam.target.x, cam.target.z]).toEqual([0, 72]);
  });

  it('dragging moves the world under the pointer (drag right → centre moves left on screen)', () => {
    const cam = new TownCamera(800, 600, def);
    cam.centerOn(36, 36);
    const before = cam.target.clone();
    cam.pan(100, 0);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.camera.quaternion).setY(0).normalize();
    expect(cam.target.clone().sub(before).dot(right)).toBeLessThan(0);
  });

  it('never shows the sky after 100 random pans and zooms (view y < -0.7)', () => {
    const cam = new TownCamera(800, 600, def);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 100; i++) {
      if (i % 2) cam.pan((rnd() - 0.5) * 900, (rnd() - 0.5) * 900);
      else cam.zoomBy(0.5 + rnd() * 1.5, [rnd() * 800, rnd() * 600]);
      expect(viewDir(cam).y).toBeLessThan(-0.7);
      expect(Math.asin(-viewDir(cam).y) * 180 / Math.PI).toBeCloseTo(55, 5);
    }
  });

  it('zooming at a point keeps that ground point under the cursor', () => {
    const cam = new TownCamera(800, 600, def);
    cam.centerOn(36, 36);
    const at: [number, number] = [600, 200];
    const before = cam.groundAt(at[0], at[1])!;
    cam.zoomBy(0.8, at);
    const after = cam.groundAt(at[0], at[1])!;
    expect(after.distanceTo(before)).toBeLessThan(0.05);
  });

  it('resize updates the aspect ratio', () => {
    const cam = new TownCamera(800, 600, def);
    cam.resize(1000, 500);
    expect(cam.camera.aspect).toBe(2);
  });
});
