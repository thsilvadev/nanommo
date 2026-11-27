/**
 * The range shown in skill tooltips, the way the battle engine reads it:
 * `maxRange` cells, or 7 for a ranged skill / 1 for a melee one without it;
 * Self for self-only skills; Blinkstrike reaches any distance.
 */
export function skillRangeLabel(skill: { target?: string; ranged?: boolean; maxRange?: number; effect?: { type?: string } } | null | undefined): string | null {
  if (!skill) return null;
  if (skill.effect?.type === 'blinkstrike') return 'Any';
  if (skill.target === 'self' && skill.maxRange === undefined) return 'Self';
  const range = Number(skill.maxRange ?? (skill.ranged ? 7 : 1));
  return Number.isFinite(range) && range > 0 ? String(range) : null;
}
