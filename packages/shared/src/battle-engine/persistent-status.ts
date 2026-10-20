/**
 * Character.statusEffects outlives an individual combat only when a successful
 * FLEE commits its checkpoint. Persist those carried effects against wall-clock
 * time; expiresAtTick is meaningful only inside one immutable battle snapshot.
 */
const STATUS_TICK_MS = 1000;

function readExpiryMs(value: unknown): number {
  if (typeof value === 'number') return value;
  return Date.parse(String(value ?? ''));
}

export function normalizePersistentStatusEffects(
  source: unknown,
  atMs: number,
): { statusEffects: any[]; changed: boolean } {
  const original = Array.isArray(source) ? source as any[] : [];
  const statusEffects: any[] = [];

  for (const raw of original) {
    if (!raw || typeof raw !== 'object') continue;
    const status = { ...raw };

    if (status.expiresAt !== undefined && status.expiresAt !== null) {
      const expiry = readExpiryMs(status.expiresAt);
      // An absolute expiry is authoritative. Invalid or elapsed effects are removed.
      if (!Number.isFinite(expiry) || expiry <= atMs) continue;
      status.expiresAt = new Date(expiry).toISOString();
      delete status.expiresAtTick;
      delete status.appliedAtTick;
      statusEffects.push(status);
      continue;
    }

    const legacyTickExpiry = status.expiresAtTick === undefined || status.expiresAtTick === null
      ? Number.NaN
      : Number(status.expiresAtTick);
    if (Number.isFinite(legacyTickExpiry)) {
      // Legacy Character rows stored a battle-local countdown with no timestamp.
      // Its elapsed wall time cannot be recovered, so do not restart it at each fight.
      continue;
    }

    // Untimed status effects have no combat tick boundary to carry into the world.
    delete status.expiresAtTick;
    delete status.appliedAtTick;
    statusEffects.push(status);
  }

  return {
    statusEffects,
    changed: JSON.stringify(original) !== JSON.stringify(statusEffects),
  };
}

export function statusEffectsForBattle(source: unknown, battleStartsAtMs: number): any[] {
  const normalized = normalizePersistentStatusEffects(source, battleStartsAtMs).statusEffects;
  return normalized.map((status: any) => {
    const copy = { ...status };
    const expiry = copy.expiresAt == null ? Number.NaN : readExpiryMs(copy.expiresAt);
    delete copy.expiresAt;
    copy.appliedAtTick = 0;
    if (Number.isFinite(expiry)) {
      copy.expiresAtTick = Math.max(1, Math.ceil((expiry - battleStartsAtMs) / STATUS_TICK_MS));
    } else {
      delete copy.expiresAtTick;
    }
    return copy;
  });
}

export function persistStatusEffectsAtCheckpoint(
  source: unknown,
  checkpointTick: number,
  atMs: number,
): any[] {
  const statuses = Array.isArray(source) ? source as any[] : [];
  const persisted: any[] = [];

  for (const raw of statuses) {
    if (!raw || typeof raw !== 'object') continue;
    const status = { ...raw };
    const expiryTick = status.expiresAtTick === undefined || status.expiresAtTick === null
      ? Number.NaN
      : Number(status.expiresAtTick);
    delete status.expiresAtTick;
    delete status.appliedAtTick;

    if (Number.isFinite(expiryTick)) {
      const remainingTicks = expiryTick - (Math.max(0, Math.floor(Number(checkpointTick) || 0)) + 1);
      if (remainingTicks <= 0) continue;
      status.expiresAt = new Date(atMs + remainingTicks * STATUS_TICK_MS).toISOString();
    } else {
      delete status.expiresAt;
    }
    persisted.push(status);
  }

  return persisted;
}
