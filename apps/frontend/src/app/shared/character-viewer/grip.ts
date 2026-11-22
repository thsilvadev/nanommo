/** Where a hand item sits in hand-bone space (moved verbatim from CharacterRig). */
import * as THREE from 'three';
import type { HandWeaponType } from '@nanommo/shared';
import type { Fist } from './body-asset';

/**
 * The handle goes through the hole of the closed fist (measured from the Idle pose), so the hand
 * wraps it. Items follow the convention of tools/character-assets: grip at the origin, long axis +Y.
 */
export function gripMatrix(fist: Fist, type: HandWeaponType): THREE.Matrix4 {
  const { centre, lateral, along, palm } = fist;
  const basis = (y: THREE.Vector3, zHint: THREE.Vector3) => {
    const yAxis = y.clone().normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zHint).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  };
  /** Handle axis: out of the thumb side, tipped towards the fingertips (downwards when the arm hangs). */
  const through = (tilt: number, outwards = 0) => lateral.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(along, Math.sin(tilt)).addScaledVector(palm, -outwards);
  let matrix: THREE.Matrix4;
  switch (type) {
    case 'greatsword':
      matrix = basis(through(0.95, 0.35), palm).setPosition(centre);
      break;
    case 'bow':
      // Nearly upright at the side, upper limb forward; the string (bow +X) faces the
      // forearm and elbow, not the space in front of the character.
      matrix = basis(through(1.25).applyAxisAngle(palm, -Math.PI / 2), palm).setPosition(centre);
      break;
    case 'staff':
      // Top leans forward, following the fist's hole, so it clears the arm.
      matrix = basis(through(-0.62, 0.22), palm).setPosition(centre);
      break;
    case 'shield':
      // On the back of the forearm, facing outwards.
      matrix = basis(along.clone().negate(), palm.clone().negate())
        .setPosition(centre.clone().addScaledVector(along, -0.15).addScaledVector(palm, -0.038));
      break;
    case 'rune':
      matrix = basis(along.clone().negate(), lateral).setPosition(centre.clone().addScaledVector(along, 0.085));
      break;
    default: // dagger, sword, rod
      matrix = basis(through(0.5, 0.15), palm).setPosition(centre);
  }
  return matrix;
}
