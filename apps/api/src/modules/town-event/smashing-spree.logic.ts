import { Mulberry32, mulberry32Seed, TownNav } from '@nanommo/shared';
import type { TownEventVase, TownSceneDef } from '@nanommo/shared';
import type { SmashingSpreeConfig, TownEventPrize } from './smashing-spree.types';

export type SmashingSpreePhase =
  | { kind: 'announce'; eventKey: string; startMs: number; minutes: number }
  | { kind: 'start'; eventKey: string; startMs: number; endsAt: number }
  | { kind: 'end'; eventKey: string; startMs: number };

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Vases keep this far from NPC spots and the spawn point. */
const KEEP_CLEAR_OF_SPOTS = 2.0;
/** ...and this far from a point-of-interest centre (where wanderers stop). */
const KEEP_CLEAR_OF_POI = 1.5;
const MAX_DRAWS_PER_VASE = 60;

export const eventKeyOf = (startMs: number) => `ss-${startMs}`;

/** Stable per-town seed for one event. */
export function eventSeed(eventKey: string, mapId: string): number {
  return mulberry32Seed(`${eventKey}:${mapId}`);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, fmt);
  }
  const get = (type: string) => Number(fmt!.formatToParts(new Date(ms)).find((p) => p.type === type)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** Offset (ms) of `timeZone` from UTC at instant `ms` (local = utc + offset). */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of local wall time y-mo-d h:mi in `timeZone`. */
function zonedEpoch(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

/** The phase of the wall-clock minute containing `nowMs`, or null. */
export function phaseAt(nowMs: number, cfg: SmashingSpreeConfig): SmashingSpreePhase | null {
  const minute = Math.floor(nowMs / MINUTE) * MINUTE;
  const local = partsIn(nowMs, cfg.timezone);
  const localMidnightUtc = Date.UTC(local.y, local.mo - 1, local.d);
  for (const dayShift of [-1, 0, 1]) {
    const day = new Date(localMidnightUtc + dayShift * DAY);
    for (const time of cfg.startTimes) {
      const [h, mi] = time.split(':').map(Number);
      const startMs = zonedEpoch(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, cfg.timezone);
      const eventKey = eventKeyOf(startMs);
      if (minute === startMs) return { kind: 'start', eventKey, startMs, endsAt: startMs + cfg.durationSeconds * 1000 };
      if (minute === Math.floor((startMs + cfg.durationSeconds * 1000) / MINUTE) * MINUTE) return { kind: 'end', eventKey, startMs };
      for (const minutes of cfg.announceMinutesBefore) {
        if (minute === startMs - minutes * MINUTE) return { kind: 'announce', eventKey, startMs, minutes };
      }
    }
  }
  return null;
}

/** Longest a GM may schedule a Smashing Spree ahead (one day). */
export const MANUAL_MAX_MINUTES = 24 * 60;

/** One phase of a GM-scheduled event and when (epoch ms) it runs. */
export interface ManualPhase { phase: SmashingSpreePhase; runAt: number }

/**
 * A GM-scheduled Smashing Spree starting `minutesToStart` minutes from `nowMs`:
 * the configured countdown announcements that fit before it (minutes ≤ the lead,
 * so 20 → 15, 5, 1; 3 → 1; 0 → none), the start and the end. Its key
 * (`ss-gm-<startMs>`) never collides with the scheduled `ss-<startMs>` ones.
 */
export function manualSchedule(nowMs: number, minutesToStart: number, cfg: SmashingSpreeConfig): ManualPhase[] {
  if (!Number.isInteger(minutesToStart) || minutesToStart < 0 || minutesToStart > MANUAL_MAX_MINUTES) {
    throw new RangeError(`minutesToStart must be an integer from 0 to ${MANUAL_MAX_MINUTES}`);
  }
  const startMs = nowMs + minutesToStart * MINUTE;
  const endsAt = startMs + cfg.durationSeconds * 1000;
  const eventKey = `ss-gm-${startMs}`;
  const announces = [...new Set(cfg.announceMinutesBefore)]
    .filter((minutes) => minutesToStart > 0 && minutes <= minutesToStart)
    .sort((a, b) => b - a)
    .map((minutes): ManualPhase => ({ phase: { kind: 'announce', eventKey, startMs, minutes }, runAt: startMs - minutes * MINUTE }));
  return [
    ...announces,
    { phase: { kind: 'start', eventKey, startMs, endsAt }, runAt: startMs },
    { phase: { kind: 'end', eventKey, startMs }, runAt: endsAt },
  ];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** `cfg.vasesPerTown` vases on reachable ground, spaced out, clear of NPCs, POI centres and the spawn. */
export function placeVases(def: TownSceneDef, nav: TownNav, seed: number, cfg: SmashingSpreeConfig): TownEventVase[] {
  const rng = new Mulberry32(seed);
  const reach = nav.reachableFrom(def.spawn.x, def.spawn.z);
  const spots = [...Object.values(def.npcSpots), def.spawn];
  const vases: TownEventVase[] = [];
  const maxDraws = cfg.vasesPerTown * MAX_DRAWS_PER_VASE;
  for (let draw = 0; draw < maxDraws && vases.length < cfg.vasesPerTown; draw++) {
    const x = round(rng.next() * def.size.w);
    const z = round(rng.next() * def.size.h);
    const rot = round(rng.next() * Math.PI * 2) % (Math.PI * 2);
    const variant = Math.floor(rng.next() * 3);
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (nav.blocked(cx, cz) || !reach.has(cz * nav.w + cx)) continue;
    if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < KEEP_CLEAR_OF_SPOTS)) continue;
    if (def.pointsOfInterest.some((p) => Math.hypot(x - p.x, z - p.z) < KEEP_CLEAR_OF_POI)) continue;
    if (vases.some((v) => Math.hypot(x - v.x, z - v.z) < cfg.minVaseSpacing)) continue;
    vases.push({ id: `v${String(vases.length).padStart(3, '0')}`, x, z, rot, variant });
  }
  if (vases.length < cfg.vasesPerTown) throw new Error(`Smashing Spree: only ${vases.length}/${cfg.vasesPerTown} vases fit in ${def.mapId}`);
  return vases;
}

/** vaseId -> prize for the prize table; `oneOf` rules pick one option per event. */
export function assignPrizes(vases: TownEventVase[], seed: number, cfg: SmashingSpreeConfig): Map<string, TownEventPrize> {
  const rng = new Mulberry32(`${seed}:prizes`);
  const order = vases.map((v) => v.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const prizes = new Map<string, TownEventPrize>();
  let next = 0;
  for (const rule of cfg.prizes) {
    const itemId = rule.itemId ?? rule.oneOf![Math.floor(rng.next() * rule.oneOf!.length)];
    for (let n = 0; n < rule.count; n++) prizes.set(order[next++], { itemId, quantity: rule.quantity });
  }
  return prizes;
}
