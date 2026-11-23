import { refinementLevel, VISIBLE_EQUIPMENT_SLOTS, type CharacterAppearance, type HandWeaponType, type Sex, type VisibleEquipment, type VisibleRefinement } from '@nanommo/shared';
import { characterAnimationState, type AnimationBattleEntry, type AnimationInput, type AnimationState, type AttackStyle } from '../../shared/character-animation/animation-state';

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

/** The equipped items the 3D model wears (the six visible slots; accessories are not shown). */
export function portraitEquipment(equipment: ReadonlyArray<{ slot: string; itemId: string }>): VisibleEquipment {
  const out: VisibleEquipment = {};
  for (const row of equipment) if ((VISIBLE_EQUIPMENT_SLOTS as readonly string[]).includes(row.slot) && row.itemId) out[row.slot as keyof VisibleEquipment] = row.itemId;
  return out;
}

/** Refinement of the worn visible slots (only refined ones): drives the gear shimmer. */
export function portraitRefinement(equipment: ReadonlyArray<{ slot: string; itemId: string; instanceData?: unknown }>): VisibleRefinement {
  const out: VisibleRefinement = {};
  for (const row of equipment) {
    if (!(VISIBLE_EQUIPMENT_SLOTS as readonly string[]).includes(row.slot) || !row.itemId) continue;
    const level = refinementLevel(row.instanceData);
    if (level) out[row.slot as keyof VisibleRefinement] = level;
  }
  return out;
}

/** Viewer inputs for a character, or null while it has no 3D appearance. */
export function portraitModel(character: {
  sex: Sex | null; heightCm: number | null; appearance: CharacterAppearance | null; dominantHand: 'right' | 'left';
} | null): PortraitModel | null {
  if (!character?.appearance || !character.sex || !character.heightCm) return null;
  return { sex: character.sex, heightCm: character.heightCm, appearance: character.appearance, dominantHand: character.dominantHand };
}

/**
 * The portrait's pose, evaluated by the 3D rig on every frame: reads the stores
 * at call time and derives the pose from (character, active battle, now) only.
 */
export function portraitAnimationSource(
  character: () => AnimationInput['character'],
  activeBattle: () => AnimationBattleEntry | null,
  hands: () => { main: HandWeaponType | null; off: HandWeaponType | null } = () => ({ main: null, off: null }),
): (nowMs: number) => AnimationState {
  return (nowMs) => {
    const { main, off } = hands();
    const attackStyle: AttackStyle = main === 'bow' || off === 'bow' ? 'bow' : 'melee';
    return characterAnimationState({ character: character(), activeBattle: activeBattle(), nowMs, attackStyle });
  };
}
