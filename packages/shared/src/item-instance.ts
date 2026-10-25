/** Shared interpretation of persisted item-instance rolls and refinement. */
const REFINABLE_DIRECT_STATS = new Set(['atk', 'matk', 'def', 'mdefPercent']);

export function refinementLevel(instanceData: any): number {
  return Math.max(0, Math.min(12, Math.floor(Number(instanceData?.refinementLevel ?? 0) || 0)));
}

/** Return an item definition with the stored refinement's direct stats included once. */
export function effectiveItemDefinition(item: any, instanceData: any): any {
  if (!item) return item;
  const level = refinementLevel(instanceData);
  if (!level) return item;
  const fixedStats = { ...(item.fixedStats ?? {}) };
  for (const stat of REFINABLE_DIRECT_STATS) {
    const base = fixedStats[stat];
    if (base !== undefined && base !== null && Number.isFinite(Number(base)) && Number(base) !== 0) {
      fixedStats[stat] = Number(base) + 3 * level;
    }
  }
  return { ...item, fixedStats };
}

export function rolledStatValue(instanceData: any, stat: string): number {
  return String(instanceData?.rolledStat ?? '') === stat
    ? Math.max(0, Number(instanceData?.rolledStatValue ?? 0) || 0)
    : 0;
}

/** Refinement failure rules are pure and shared by API enforcement and rule tests. */
export function resolveRefinementFailure(currentLevelValue: number, useDivineShard: boolean): { destroyed: boolean; nextLevel: number } {
  const level = Math.max(0, Math.min(11, Math.floor(Number(currentLevelValue) || 0)));
  if (level >= 9 && !useDivineShard) return { destroyed: true, nextLevel: level };
  if (level >= 9 && useDivineShard) return { destroyed: false, nextLevel: level - 1 };
  if (level >= 6 && level <= 8 && !useDivineShard) return { destroyed: false, nextLevel: 0 };
  return { destroyed: false, nextLevel: level };
}
