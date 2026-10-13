export interface MasteryXpPolicy {
  twoHandedAction: number;
  oneHandedAction: number;
  shieldOnHit: number;
  runeOnHit: number;
}

export type MasteryXpAward = Record<string, number>;

/** Cumulative XP threshold by Mastery level: index 0 is level 0, indices 1–10 are levels 1–10. */
export const MASTERY_LEVEL_XP_THRESHOLDS = [0, 5, 10, 25, 50, 100, 500, 25_000, 35_000, 45_000, 60_000] as const;

/** Derive the authoritative level from cumulative XP; Mastery is capped at 10. */
export function masteryLevelForXp(xp: number): number {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 0;
  for (let i = 1; i < MASTERY_LEVEL_XP_THRESHOLDS.length; i++) {
    if (total < MASTERY_LEVEL_XP_THRESHOLDS[i]) break;
    level = i;
  }
  return Math.min(10, level);
}

/** Resolve rank-dependent active-skill costs and cooldowns at snapshot time. */
export function resolveRankScaledSkill(definition: any, rankValue: number, storedEssenceRank = 0): any {
  const resolved = { ...definition };
  const rank = Math.max(1, Math.floor(Number(rankValue) || 1));
  let baseSpCost = Number(resolved.spCost ?? 0);
  if (Array.isArray(resolved.spCostByRank)) {
    baseSpCost = Number(resolved.spCostByRank[Math.min(rank, resolved.spCostByRank.length) - 1] ?? baseSpCost);
  } else if (Number.isFinite(Number(resolved.spCostPerRank))) {
    baseSpCost = Number(resolved.spCostPerRank) * rank;
  }
  resolved.baseSpCost = Math.max(0, Math.floor(baseSpCost));
  const essenceRank = Math.max(0, Math.floor(Number(storedEssenceRank) || 0));
  resolved.spCost = resolved.baseSpCost > 0 && essenceRank > 0
    ? Math.max(1, Math.floor(resolved.baseSpCost * (1 - 0.05 * essenceRank)))
    : resolved.baseSpCost;
  if (Array.isArray(resolved.cooldownTicksByRank)) {
    resolved.cooldownTicks = Number(resolved.cooldownTicksByRank[Math.min(rank, resolved.cooldownTicksByRank.length) - 1]
      ?? resolved.cooldownTicks ?? 0);
  }
  return resolved;
}

/** Calculate deterministic rewards solely from the immutable battle log. */
export function calculateMasteryXpAwards(log: any, policy: MasteryXpPolicy): MasteryXpAward {
  const awards: MasteryXpAward = {};
  const equipment = log?.header?.characterSnapshot?.masteryEquipment;
  if (!Array.isArray(equipment)) return awards;
  const add = (category: string, amount: number) => {
    if (amount > 0) awards[category] = (awards[category] ?? 0) + amount;
  };
  for (const event of log?.events ?? []) {
    const successfulBasicAttack = event.action === 'attack' && event.target === 'monster' && event.hit === true;
    // The simulator records an active skill event only after its SP/cooldown and
    // execution checks have succeeded. Active skills can target self (heals/buffs)
    // as well as the enemy, and must still count as one offensive Mastery action.
    const executedActiveSkill = event.action === 'use_skill' && event.hit !== false;
    if (event.actor === 'character' && (successfulBasicAttack || executedActiveSkill)) {
      for (const hand of equipment) {
        // Shield and Rune are defensive Mastery categories, not offensive weapons.
        if (hand.category === 'shield' || hand.category === 'rune') continue;
        add(hand.category, hand.twoHanded ? policy.twoHandedAction : policy.oneHandedAction);
      }
    }
    if (event.actor === 'monster' && event.target === 'character' && event.hit === true &&
      (event.action === 'attack' || event.action === 'use_skill')) {
      for (const hand of equipment) {
        if (hand.category === 'shield') add('shield', policy.shieldOnHit);
        if (hand.category === 'rune') add('rune', policy.runeOnHit);
      }
    }
  }
  return awards;
}
