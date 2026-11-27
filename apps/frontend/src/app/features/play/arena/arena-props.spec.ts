import * as THREE from 'three';
import { ARENA_NEAR_LAYER_DISTANCE_M, ArenaProps, behindNearLayer } from './arena-props';

describe('ArenaProps behind the painted near layer', () => {
  it('a point is behind the near layer along the view, which turns with the camera yaw', () => {
    // Front view (yaw 0): the layer is 22 m away along -z; the props' depth band (to -24) barely reaches it.
    expect(behindNearLayer(0, -21, 0)).toBeFalse();
    expect(behindNearLayer(0, -23, 0)).toBeTrue();
    expect(behindNearLayer(60, 0, 0)).toBeFalse(); // far to the side is not "behind" from the front
    // Turned 70° (orbit limit): looking along the props' long axis, far props are behind the layer.
    const yaw = (70 * Math.PI) / 180;
    expect(behindNearLayer(-60, 0, yaw)).toBeTrue();
    expect(behindNearLayer(-10, 0, yaw)).toBeFalse();
    expect(behindNearLayer(60, 0, yaw)).toBeFalse();
    expect(behindNearLayer(-60, 0, -yaw)).toBeFalse();
    expect(behindNearLayer(60, 0, -yaw)).toBeTrue();
  });

  it('the props material culls with the same direction the backdrop turns to', () => {
    const props = new ArenaProps('green_grounds', 1);
    expect(props.awayDirection().distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-9);
    const yaw = (70 * Math.PI) / 180;
    props.setYaw(yaw);
    const away = props.awayDirection();
    // The rotated backdrop's local -z, in scenery-local space.
    const layerDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    expect(away.distanceTo(layerDir)).toBeLessThan(1e-9);
    // Same rule as behindNearLayer on a sample point.
    const p = new THREE.Vector3(-60, 0, 0);
    expect(p.dot(away) > ARENA_NEAR_LAYER_DISTANCE_M).toBe(behindNearLayer(p.x, p.z, yaw));
    props.dispose();
  });
});
