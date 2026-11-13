/** Shared deterministic conversion contract for the 500 ms combat clock. */
export const DEFAULT_BATTLE_TICK_DURATION_MS = 500 as const;
export const MILLISECONDS_PER_SECOND = 1000 as const;

/** Durations round up so a positive deadline never expires earlier than configured. */
export function secondsToBattleTicks(seconds: number, tickDurationMs: number = DEFAULT_BATTLE_TICK_DURATION_MS): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil((value * MILLISECONDS_PER_SECOND) / tickDurationMs);
}

/** Remaining wall-clock deadlines also round up to preserve their inclusive boundary. */
export function millisecondsToBattleTicks(milliseconds: number, tickDurationMs: number = DEFAULT_BATTLE_TICK_DURATION_MS): number {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / tickDurationMs);
}

export function battleTicksToMilliseconds(ticks: number, tickDurationMs: number = DEFAULT_BATTLE_TICK_DURATION_MS): number {
  const value = Number(ticks);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value * tickDurationMs;
}
