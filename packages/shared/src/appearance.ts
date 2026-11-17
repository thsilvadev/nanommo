/**
 * Character appearance rules shared by the API (authoritative) and the
 * frontend (preview only). Pure functions; no I/O.
 */

export type Sex = 'male' | 'female';
export type HeightBand = 1 | 2 | 3 | 4;

export const HEIGHT_CM_MIN = 145;
export const HEIGHT_CM_MAX = 205;

export const APPEARANCE_TRAITS = [
  'hair', 'hairColor', 'skin', 'face', 'nose', 'mouth', 'mouthDetails', 'chest', 'facialHair', 'piercing', 'tattoo',
] as const;

/** Most options any single trait may list. */
export const MAX_APPEARANCE_OPTIONS = 8;
export type AppearanceTrait = typeof APPEARANCE_TRAITS[number];

/** Traits whose option list is identical for both sexes. */
export const SHARED_APPEARANCE_TRAITS: readonly AppearanceTrait[] = ['piercing', 'tattoo'];

/** Each trait value is an index into the catalogue list for that trait and sex. */
export type CharacterAppearance = { v: 1 } & Record<AppearanceTrait, number>;

export interface AppearanceOption {
  id: string;
  name: { locales: { en: string; pt: string } };
  asset?: string;
  color?: string;
  params?: Record<string, number>;
}

export interface AppearanceCatalog {
  version: 1;
  male: Record<AppearanceTrait, AppearanceOption[]>;
  female: Record<AppearanceTrait, AppearanceOption[]>;
}

export interface AppearanceInput {
  sex: Sex;
  heightCm: number;
  appearance: CharacterAppearance;
}

function isHeightCm(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= HEIGHT_CM_MIN && value <= HEIGHT_CM_MAX;
}

/** 145 → 1, 146–175 → 2, 176–204 → 3, 205 → 4. */
export function heightBandFromCm(heightCm: number): HeightBand {
  if (!isHeightCm(heightCm)) {
    throw new RangeError(`heightCm must be an integer from ${HEIGHT_CM_MIN} to ${HEIGHT_CM_MAX}`);
  }
  if (heightCm === HEIGHT_CM_MIN) return 1;
  if (heightCm === HEIGHT_CM_MAX) return 4;
  return heightCm <= 175 ? 2 : 3;
}

const HEIGHT_ADJUSTMENTS: Record<HeightBand, { str: number; luk: number }> = {
  1: { str: -2, luk: 2 },
  2: { str: -1, luk: 1 },
  3: { str: 1, luk: -1 },
  4: { str: 2, luk: -2 },
};

/** One-time base attribute adjustment applied when the appearance is saved. */
export function heightAttributeAdjustment(band: HeightBand): { str: number; luk: number } {
  const adjustment = HEIGHT_ADJUSTMENTS[band];
  if (!adjustment) throw new RangeError('height band must be 1, 2, 3 or 4');
  return { ...adjustment };
}

export function defaultAppearance(): CharacterAppearance {
  const appearance = { v: 1 } as CharacterAppearance;
  for (const trait of APPEARANCE_TRAITS) appearance[trait] = 0;
  return appearance;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const INPUT_KEYS: readonly string[] = ['sex', 'heightCm', 'appearance'];
const APPEARANCE_KEYS: readonly string[] = ['v', ...APPEARANCE_TRAITS];

/** Returns every problem found; an empty list means the input is valid. Never throws. */
export function validateAppearanceInput(input: unknown, catalog: AppearanceCatalog | null | undefined): string[] {
  if (!isPlainObject(input)) return ['appearance input must be an object'];
  const errors: string[] = [];

  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.includes(key)) errors.push(`unknown field: ${key}`);
  }

  const sex = input.sex;
  const sexValid = sex === 'male' || sex === 'female';
  if (!sexValid) errors.push('sex must be male or female');

  if (!isHeightCm(input.heightCm)) {
    errors.push(`heightCm must be an integer from ${HEIGHT_CM_MIN} to ${HEIGHT_CM_MAX}`);
  }

  const appearance = input.appearance;
  if (!isPlainObject(appearance)) {
    errors.push('appearance must be an object');
    return errors;
  }
  for (const key of Object.keys(appearance)) {
    if (!APPEARANCE_KEYS.includes(key)) errors.push(`unknown appearance field: ${key}`);
  }
  if (appearance.v !== 1) errors.push('appearance.v must be 1');

  const options = sexValid && isPlainObject(catalog) ? (catalog as any)[sex as Sex] : null;
  if (sexValid && !isPlainObject(options)) errors.push('appearance catalogue is unavailable');

  for (const trait of APPEARANCE_TRAITS) {
    const value = appearance[trait];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      errors.push(`appearance.${trait} must be a non-negative integer`);
      continue;
    }
    if (!isPlainObject(options)) continue;
    const list = (options as any)[trait];
    if (!Array.isArray(list) || value >= list.length) {
      errors.push(`appearance.${trait} is not an available option`);
    }
  }
  return errors;
}

export type HandWeaponType = 'dagger' | 'sword' | 'greatsword' | 'bow' | 'staff' | 'rod' | 'shield' | 'rune';

/**
 * Which physical hand shows each equipped hand item. The main-hand item goes
 * in the dominant hand (two-handed weapons included); the off-hand item goes
 * in the other one.
 */
export function resolveHandAttachments(
  dominantHand: 'right' | 'left',
  mainHandType: HandWeaponType | null,
  offHandType: HandWeaponType | null,
): { right: HandWeaponType | null; left: HandWeaponType | null } {
  const main = mainHandType ?? null;
  const off = offHandType ?? null;
  return dominantHand === 'left' ? { right: off, left: main } : { right: main, left: off };
}

const OPTIONAL_SHARED_FIRST_ID = 'none';

/** Structural checks for appearance_catalog.json. Returns every problem found; never throws. */
export function validateAppearanceCatalog(catalog: unknown): string[] {
  if (!isPlainObject(catalog)) return ['appearance catalogue must be an object'];
  const errors: string[] = [];
  if (catalog.version !== 1) errors.push('appearance catalogue version must be 1');

  for (const sex of ['male', 'female'] as const) {
    const traits = catalog[sex];
    if (!isPlainObject(traits)) {
      errors.push(`${sex} must be an object of traits`);
      continue;
    }
    for (const key of Object.keys(traits)) {
      if (!(APPEARANCE_TRAITS as readonly string[]).includes(key)) errors.push(`${sex}.${key} is not a known trait`);
    }
    for (const trait of APPEARANCE_TRAITS) {
      const options = traits[trait];
      if (!Array.isArray(options) || options.length < 1 || options.length > MAX_APPEARANCE_OPTIONS) {
        errors.push(`${sex}.${trait} must list 1 to ${MAX_APPEARANCE_OPTIONS} options`);
        continue;
      }
      const ids = new Set<string>();
      for (const option of options) {
        const id = isPlainObject(option) ? option.id : undefined;
        if (typeof id !== 'string' || !id || ids.has(id)) {
          errors.push(`${sex}.${trait} has a missing or duplicate option id`);
          continue;
        }
        ids.add(id);
        const locales = isPlainObject(option.name) && isPlainObject(option.name.locales) ? option.name.locales : {};
        for (const locale of ['en', 'pt']) {
          const text = (locales as Record<string, unknown>)[locale];
          if (typeof text !== 'string' || !text.trim()) errors.push(`${sex}.${trait}.${id} is missing its ${locale} name`);
        }
        if ((trait === 'hairColor' || trait === 'skin') && !/^#[0-9a-f]{6}$/i.test(String(option.color ?? ''))) {
          errors.push(`${sex}.${trait}.${id} must define a #rrggbb color`);
        }
      }
    }
  }

  if (isPlainObject(catalog.male) && isPlainObject(catalog.female)) {
    for (const trait of SHARED_APPEARANCE_TRAITS) {
      const male = catalog.male[trait];
      const female = catalog.female[trait];
      if (JSON.stringify(male) !== JSON.stringify(female)) errors.push(`${trait} must be identical for both sexes`);
      if (Array.isArray(male) && (male[0] as any)?.id !== OPTIONAL_SHARED_FIRST_ID) errors.push(`${trait} must start with "none"`);
    }
  }
  return errors;
}
