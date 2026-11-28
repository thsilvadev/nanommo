/** Definitive KO only, called inside the owning settlement transaction. */
export function deathXpLoss(xpToNext: number, currentXp: number): number {
  if (!Number.isFinite(xpToNext) || !Number.isFinite(currentXp)) return 0;
  return Math.min(Math.max(0, Math.floor(currentXp)), Math.floor(Math.max(0, xpToNext) * 0.02));
}
