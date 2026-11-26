import { Mulberry32 } from '@nanommo/shared';

export function assertPartyJoin(input: { memberIds: string[]; candidateId: string; mapId: string; candidateMapId: string; leaderId: string; requesterId: string }): void {
  if (input.requesterId !== input.leaderId) throw new Error('Only the leader can invite');
  if (input.mapId !== input.candidateMapId) throw new Error('Characters must be on the same map');
  if (input.memberIds.includes(input.candidateId)) throw new Error('Already a party member');
  if (input.memberIds.length >= 5) throw new Error('Party is full');
}
export function nextPartyLeader(memberIds: string[], seed: string): string | null {
  const ids = [...memberIds].sort();
  return ids.length ? new Mulberry32(seed).pick(ids) : null;
}
/** Equality belongs to the encounter, not the command. */
export function pendingActionAtBoundary(now: number, dueAt: number | null, battleActive: boolean): boolean {
  return !battleActive && (dueAt === null || now < dueAt);
}
export function advanceTeleport<T extends { elapsedMs: number; lastAccruedAt: number; paused: boolean }>(state: T, now: number, paused: boolean): T {
  return { ...state, elapsedMs: Math.min(10000, state.elapsedMs + (state.paused ? 0 : Math.max(0, now - state.lastAccruedAt))), lastAccruedAt: now, paused };
}

/**
 * The Town Guard's rule (as for a solo trip, MapService): leaving Town needs food still digesting — the
 * Diet or a legacy active food buff. Nothing is eaten here: Auto Feed works at battle boundaries, not at the gate.
 */
export function townGuardHungry(character: { diet?: Array<{ digestUntil?: string | null }> | null; activeFoodBuff?: { expiresAt?: string | null } | null }, now: number): boolean {
  const buff = Date.parse(String(character.activeFoodBuff?.expiresAt ?? '')) || 0;
  const diet = (Array.isArray(character.diet) ? character.diet : []).reduce((max, row) => Math.max(max, Date.parse(String(row?.digestUntil ?? '')) || 0), 0);
  return Math.max(buff, diet) <= now;
}
