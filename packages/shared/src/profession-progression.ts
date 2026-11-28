const KNOWN = [0, 20, 44, 78, 128, 328, 828, 1578];
export function professionThreshold(level: number): number {
  level = Number.isFinite(level) ? Math.max(1, Math.min(100, Math.floor(level))) : 1;
  if (level <= KNOWN.length) return KNOWN[level - 1];
  let total = KNOWN[7], increment = 750;
  for (let current = 8; current < level; current++) { increment = Math.floor(increment * 1.2); total += increment; }
  return total;
}
export function professionLevelForXp(value: number): number {
  const xp = Number.isFinite(value) ? Math.max(0, value) : 0;
  let level = 1;
  while (level < 99 && xp >= professionThreshold(level + 1)) level++;
  return level;
}
export function professionProgressForXp(value: number, minimumLevel = 1) {
  const xp = Number.isFinite(value) ? Math.max(0, value) : 0;
  const level = Math.max(professionLevelForXp(xp), Math.min(99, Math.max(1, Math.floor(minimumLevel) || 1)));
  const current = professionThreshold(level), next = professionThreshold(level + 1);
  return { level, xp, totalXp: xp, xpIntoLevel: Math.max(0, xp - current), xpToNextLevel: next - current, nextLevelXp: next,
    progressPercent: Math.max(0, Math.min(100, (xp - current) / Math.max(1, next - current) * 100)) };
}
