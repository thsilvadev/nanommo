/**
 * Attribute modifier aggregation (SPEC §5, §17).
 *
 * An effective attribute is `base + totalBonus`, where the total bonus
 * folds every modifier source — equipment stat bonuses, learned mastery
 * passives, and any future buff/debuff — into one value. Sources are
 * plain partial maps, so new contributors plug in without edits here.
 */
export type AttributeKey = 'STR' | 'AGI' | 'DEX' | 'VIT' | 'INT' | 'LUK';

export type AttributeBonuses = Record<AttributeKey, number>;

export type BaseAttributes = {
  str: number;
  agi: number;
  dex: number;
  vit: number;
  int: number;
  luk: number;
};

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = ['STR', 'AGI', 'DEX', 'VIT', 'INT', 'LUK'];

export function emptyAttributeBonuses(): AttributeBonuses {
  return { STR: 0, AGI: 0, DEX: 0, VIT: 0, INT: 0, LUK: 0 };
}

/**
 * Fold every attribute modifier source into the final total bonus.
 * Missing sources and missing keys count as zero; sources stack
 * additively.
 */
export function sumAttributeBonuses(
  ...sources: Array<Partial<Record<AttributeKey, number>> | null | undefined>
): AttributeBonuses {
  const total = emptyAttributeBonuses();
  for (const source of sources) {
    if (!source) continue;
    for (const key of ATTRIBUTE_KEYS) {
      total[key] += Number(source[key] ?? 0) || 0;
    }
  }
  return total;
}

/** Effective attributes: each base value plus the aggregated total bonus. */
export function applyAttributeBonuses(
  base: BaseAttributes,
  bonus: AttributeBonuses,
): BaseAttributes {
  return {
    str: Number(base.str ?? 0) + bonus.STR,
    agi: Number(base.agi ?? 0) + bonus.AGI,
    dex: Number(base.dex ?? 0) + bonus.DEX,
    vit: Number(base.vit ?? 0) + bonus.VIT,
    int: Number(base.int ?? 0) + bonus.INT,
    luk: Number(base.luk ?? 0) + bonus.LUK,
  };
}

/**
 * Attribute bonuses granted by learned passive skills — e.g. Brutality's
 * `+6 STR per rank`. Data-driven: a passive contributes
 * `masteryRank * effect.<attribute>PerRank` for every per-rank attribute
 * field its effect defines, so new attribute passives need no code change.
 * `skillDefs` must only contain definitions of the character's equipped
 * weapon categories, mirroring the combat-snapshot gate.
 */
export function masteryPassiveAttributeBonuses(
  skillDefs: Record<string, any> | null | undefined,
): Partial<AttributeBonuses> {
  const bonus: Partial<AttributeBonuses> = {};
  if (!skillDefs) return bonus;
  for (const definition of Object.values(skillDefs)) {
    if (!definition || definition.kind === 'active') continue;
    const rank = Math.max(0, Math.floor(Number(definition.masteryRank ?? 0)));
    if (rank < 1) continue;
    const effect = definition.effect ?? {};
    for (const key of ATTRIBUTE_KEYS) {
      const perRank = Number(effect[`${key.toLowerCase()}PerRank`] ?? 0);
      if (perRank > 0) {
        bonus[key] = (bonus[key] ?? 0) + rank * perRank;
      }
    }
  }
  return bonus;
}
