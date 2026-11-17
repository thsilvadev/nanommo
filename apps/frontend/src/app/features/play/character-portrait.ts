import type { CharacterAppearance, HandWeaponType, Sex } from '@nanommo/shared';

const HAND_TYPES: ReadonlySet<string> = new Set<HandWeaponType>(['dagger', 'sword', 'greatsword', 'bow', 'staff', 'rod', 'shield', 'rune']);

export interface PortraitModel {
  sex: Sex;
  heightCm: number;
  appearance: CharacterAppearance;
  dominantHand: 'right' | 'left';
}

/** The weapon type shown in each hand slot; anything the viewer has no model for shows an empty hand. */
export function portraitHandTypes(
  equipment: ReadonlyArray<{ slot: string; itemId: string }>,
  item: (id: string) => { weaponType?: string } | undefined,
): { main: HandWeaponType | null; off: HandWeaponType | null } {
  const typeIn = (slot: string): HandWeaponType | null => {
    const row = equipment.find((entry) => entry.slot === slot);
    const type = row ? item(row.itemId)?.weaponType : undefined;
    return type && HAND_TYPES.has(type) ? (type as HandWeaponType) : null;
  };
  return { main: typeIn('mainHand'), off: typeIn('offHand') };
}

/** Viewer inputs for a character, or null while it has no 3D appearance. */
export function portraitModel(character: {
  sex: Sex | null; heightCm: number | null; appearance: CharacterAppearance | null; dominantHand: 'right' | 'left';
} | null): PortraitModel | null {
  if (!character?.appearance || !character.sex || !character.heightCm) return null;
  return { sex: character.sex, heightCm: character.heightCm, appearance: character.appearance, dominantHand: character.dominantHand };
}
