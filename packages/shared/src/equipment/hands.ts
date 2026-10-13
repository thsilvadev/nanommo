/**
 * Validate semantic mainHand/offHand loadouts using the item catalogue as the
 * authority for slots and twoHanded metadata.
 */
export function validateHandLoadout(
  mainHand: any | null | undefined,
  offHand: any | null | undefined,
): string[] {
  const errors: string[] = [];
  if (!mainHand && offHand) errors.push('An off-hand item requires a one-handed primary weapon');
  if (mainHand && (mainHand.type !== 'equipment' || mainHand.slot !== 'mainHand' || !mainHand.weaponType)) {
    errors.push('Primary hand must contain a primary weapon');
  }
  if (offHand && (offHand.type !== 'equipment' || !(offHand.slot === 'offHand' || offHand.secondaryHand === true) || !offHand.weaponType)) {
    errors.push('Secondary hand item is not classified for the secondary slot');
  }
  if (mainHand?.twoHanded && offHand) errors.push('A two-handed primary occupies both hands');
  // The primary catalogue entry owns the exact pairing matrix. This allows
  // Dagger + Dagger while explicitly omitting Sword + Sword.
  if (mainHand && offHand && !mainHand.twoHanded &&
    !Array.isArray(mainHand.allowedOffHandTypes)) {
    errors.push('Primary weapon is missing secondary-hand pairing metadata');
  } else if (mainHand && offHand && !mainHand.twoHanded &&
    !mainHand.allowedOffHandTypes.includes(offHand.weaponType)) {
    errors.push(`${mainHand.weaponType} cannot pair with ${offHand.weaponType}`);
  }
  return errors;
}

/** Weapon ATK only is reduced in the secondary slot; all other item stats stay full. */
export function effectiveWeaponAttack(item: any, slot: string): number {
  const atk = Number(item?.fixedStats?.atk ?? 0);
  return slot === 'offHand' ? Math.floor(atk / 2) : atk;
}
