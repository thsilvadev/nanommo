import * as THREE from 'three';
import { gripMatrix } from './grip';
import type { Fist } from './body-asset';

describe('hand item placement', () => {
  const fist: Fist = { centre: new THREE.Vector3(0.1, 0.2, 0.3), lateral: new THREE.Vector3(1, 0, 0), along: new THREE.Vector3(0, 1, 0), palm: new THREE.Vector3(0, 0, 1) };

  it('enlarges bow limbs and string together by 35% around the fixed hand grip', () => {
    const placement = gripMatrix(fist, 'bow');
    const grip = new THREE.Vector3().applyMatrix4(placement);
    expect(grip.distanceTo(fist.centre)).toBeCloseTo(0, 6);
    // A metre between limb tips becomes 1.35 m; the string follows the same local frame.
    const top = new THREE.Vector3(0, 0.5, 0).applyMatrix4(placement);
    const bottom = new THREE.Vector3(0, -0.5, 0).applyMatrix4(placement);
    expect(top.distanceTo(bottom)).toBeCloseTo(1.35, 6);
    const nock = new THREE.Vector3(0.2, 0, 0).applyMatrix4(placement);
    expect(nock.distanceTo(grip)).toBeCloseTo(0.27, 6);
  });

  it('keeps other hand items at their authored size', () => {
    const placement = gripMatrix(fist, 'sword');
    expect(new THREE.Vector3(0, 1, 0).applyMatrix4(placement).distanceTo(fist.centre)).toBeCloseTo(1, 6);
  });
});
