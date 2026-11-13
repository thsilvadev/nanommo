/** Per-entry combat clock metadata. Missing metadata is intentionally not guessed. */
export function battleTickDurationMs(entry: any): number | null {
  const value = Number(entry?.tickDurationMs ?? entry?.log?.header?.tickDurationMs);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function battleTickAt(entry: any, timestampMs = Date.now()): number | null {
  const tickDurationMs = battleTickDurationMs(entry);
  const startAtMs = Date.parse(String(entry?.startAt ?? ''));
  if (tickDurationMs === null || !Number.isFinite(startAtMs) || !Number.isFinite(timestampMs)) return null;
  return Math.max(0, Math.floor((timestampMs - startAtMs) / tickDurationMs));
}

export function battleTickExpiryRemainingSeconds(entry: any, expiresAtTick: number, nowMs = Date.now()): number | null {
  const tickDurationMs = battleTickDurationMs(entry);
  const startAtMs = Date.parse(String(entry?.startAt ?? ''));
  if (tickDurationMs === null || !Number.isFinite(startAtMs) || !Number.isFinite(Number(expiresAtTick))) return null;
  return Math.max(0, Math.ceil((startAtMs + Number(expiresAtTick) * tickDurationMs - nowMs) / 1000));
}
