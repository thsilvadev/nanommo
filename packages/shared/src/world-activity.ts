import { Mulberry32 } from './battle-engine/prng';

export type WorldMapNode = {
  id: string;
  type: 'town' | 'grind' | string;
  isClickable?: boolean;
  coordinates: { x: number; y: number };
  mapLength?: number;
};

/** Deterministic shortest path over clickable canonical map nodes, matching MapBoard's ID tie-break. */
export function findCardinalRoute<T extends WorldMapNode>(maps: T[], fromMapId: string, destinationMapId: string): T[] {
  const byId = new Map(maps.map(map => [map.id, map]));
  const origin = byId.get(fromMapId);
  const destination = byId.get(destinationMapId);
  if (!origin || !destination || origin.isClickable === false || destination.isClickable === false) return [];
  if (fromMapId === destinationMapId) return [origin];

  const queue: T[] = [origin];
  const previous = new Map<string, string | null>([[origin.id, null]]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.id === destinationMapId) break;
    const neighbors = maps.filter(candidate => candidate.isClickable !== false)
      .filter(candidate => Math.abs(Number(candidate.coordinates.x) - Number(current.coordinates.x)) +
        Math.abs(Number(candidate.coordinates.y) - Number(current.coordinates.y)) === 1)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const neighbor of neighbors) {
      if (previous.has(neighbor.id)) continue;
      previous.set(neighbor.id, current.id);
      queue.push(neighbor);
    }
  }
  if (!previous.has(destinationMapId)) return [];
  const route: T[] = [];
  let cursor: string | null = destinationMapId;
  while (cursor !== null) {
    const node = byId.get(cursor);
    if (!node) return [];
    route.unshift(node);
    cursor = previous.get(cursor) ?? null;
  }
  return route;
}

export function isInstantTownExitEdge(from: WorldMapNode | undefined, to: WorldMapNode | undefined): boolean {
  if (!from || !to) return false;
  const adjacent = Math.abs(Number(from.coordinates.x) - Number(to.coordinates.x)) +
    Math.abs(Number(from.coordinates.y) - Number(to.coordinates.y)) === 1;
  // Only exiting a Town is instantaneous. Returning from a Grind map to a Town
  // is a normal timed segment, using the source Grind map's mapLength.
  return adjacent && from.type === 'town' && to.type === 'grind';
}

/** World speed is deliberately separate from combat-lane movement speed. */
export function calculateWorldMoveSpeed(character: any, equipment: any[] = [], activeBuffs: any[] = [], statuses: any[] = [], atMs = Date.now()): number {
  const level = Math.max(1, Number(character?.level ?? 1));
  let flat = 0;
  let multiplier = 1;
  for (const entry of equipment) {
    const def = entry?.definition ?? entry?.item ?? entry;
    const fixed = def?.fixedStats ?? {};
    const statBonus = fixed?.statBonus ?? def?.statBonus ?? {};
    flat += Number(fixed.moveSpd ?? fixed.moveSpeed ?? statBonus.moveSpd ?? statBonus.moveSpeed ?? def?.moveSpdFlat ?? 0) || 0;
    multiplier *= Math.max(0, Number(def?.moveSpdMultiplier ?? fixed?.moveSpdMultiplier ?? 1));
  }
  for (const buff of activeBuffs) {
    const expiryRaw = buff?.expiresAt ?? buff?.endsAt;
    const expiry = typeof expiryRaw === 'number' ? expiryRaw : Date.parse(String(expiryRaw ?? ''));
    if (Number.isFinite(expiry) && expiry <= atMs) continue;
    flat += Number(buff?.moveSpdFlat ?? buff?.moveSpeedFlat ?? buff?.effects?.moveSpdFlat ?? 0) || 0;
    multiplier *= Math.max(0, Number(buff?.moveSpdMultiplier ?? buff?.moveSpeedMultiplier ?? buff?.effects?.moveSpdMultiplier ?? 1));
  }
  let penalties = 0;
  for (const status of statuses) {
    penalties += Math.max(0, Number(status?.moveSpeedPenalty ?? status?.moveSpdPenalty ?? 0) || 0);
  }
  return Math.max(0, Math.min(250, Math.floor(((50 + level + flat) * multiplier) - penalties)));
}

export interface TravelSegmentAccrual {
  progress: number;
  completed: boolean;
  /** The historical instant at which the segment finished, if it finished. */
  completedAt: number | null;
  /** Non-battle elapsed time after completion to carry into the next segment. */
  remainingSeconds: number;
  elapsedSeconds: number;
}

/**
 * Accrue a single segment at the previously persisted fill rate. Returning the
 * historical completion instant allows restart catch-up to carry elapsed time
 * through subsequent legs instead of silently dropping it at each map boundary.
 */
export function accrueTravelSegmentProgress(
  progress: number,
  lastAccruedAt: number,
  now: number,
  previousDurationSeconds: number,
): TravelSegmentAccrual {
  const normalizedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const elapsedSeconds = Math.max(0, (Number(now) - Number(lastAccruedAt)) / 1000);
  const duration = Number(previousDurationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { progress: normalizedProgress, completed: normalizedProgress >= 1, completedAt: null, remainingSeconds: 0, elapsedSeconds };
  }
  if (normalizedProgress >= 1) {
    const completedAt = Number(lastAccruedAt);
    return { progress: 1, completed: true, completedAt, remainingSeconds: Math.max(0, (Number(now) - completedAt) / 1000), elapsedSeconds };
  }
  const rawProgress = normalizedProgress + elapsedSeconds / duration;
  if (rawProgress < 1) return { progress: rawProgress, completed: false, completedAt: null, remainingSeconds: 0, elapsedSeconds };
  const completedAt = Number(lastAccruedAt) + (1 - normalizedProgress) * duration * 1000;
  return {
    progress: 1,
    completed: true,
    completedAt,
    remainingSeconds: Math.max(0, (Number(now) - completedAt) / 1000),
    elapsedSeconds,
  };
}

/** Travel-segment duration; returned value is Infinity when effective speed is zero. */
export function calculateTravelDurationSeconds(moveSpd: number, mapLength: number): number {
  const speed = Math.max(0, Math.min(250, Number(moveSpd) || 0));
  if (speed <= 0) return Number.POSITIVE_INFINITY;
  let base: number;
  if (speed < 51) base = 30 * 51 / speed;
  else if (speed <= 100) base = 30 - (speed - 51) * (10 / 49);
  else base = 20 - (speed - 100) * (15 / 150);
  const length = Math.max(25, Number(mapLength) || 0);
  return Math.max(5, base) * length / 25;
}

/**
 * Relative speed sets the main escape chance. LUK contributes only toward the
 * middle of the curve and has exactly zero influence at the 1%/99% endpoints.
 */
export function calculateFleeChancePercent(characterMoveSpd: number, monsterMoveSpd: number, totalLuk: number): number {
  const charSpeed = Math.max(0, Number(characterMoveSpd) || 0);
  const foeSpeed = Math.max(1, Number(monsterMoveSpd) || 0);
  const relative = Math.max(-0.5, Math.min(0.5, charSpeed / foeSpeed - 1));
  const speedChance = 1 + (relative + 0.5) * 98;
  const luckScore = Math.max(1, Math.min(99, 50 + 2 * ((Number(totalLuk) || 0) - 5)));
  const t = (speedChance - 1) / 98;
  const edgeWeight = 4 * t * (1 - t);
  return Math.max(1, Math.min(99, speedChance + 0.10 * (luckScore - speedChance) * edgeWeight));
}

export function deterministicIntInclusive(seed: string, min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return new Mulberry32(seed).nextIntInclusive(low, high);
}

export function calculateGatheringBaseDurationSeconds(mapLength: number, playersOnMap: number, gatheringLevel = 1): number {
  return Math.max(30, 12 * Math.max(0, Number(mapLength) || 0) +
    30 * (Math.max(1, Math.floor(Number(playersOnMap) || 1)) - 1) -
    (Math.max(1, Math.floor(Number(gatheringLevel) || 1)) - 1));
}

export function calculateGatheringDurationSeconds(mapLength: number, playersOnMap: number, gatheringLevel = 1, cycleSeed = 'gathering-cycle'): number {
  return calculateGatheringBaseDurationSeconds(mapLength, playersOnMap, gatheringLevel) + deterministicIntInclusive(cycleSeed, 0, 5);
}
