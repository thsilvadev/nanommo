/**
 * Where every combatant stands at `nowMs`, which way it faces, its HP/SP,
 * shown statuses, death and flee — a pure function of (battle, now).
 *
 * Nothing accumulates between calls, so opening the arena mid-battle or after
 * a sleeping tab lands on exactly the frame continuous playback would reach.
 * The log is pre-computed, so an approach step may start before the tick that
 * records it (the actor arrives on that tick).
 */
import type { ArenaBattle, ArenaCell, ArenaEvent } from './arena.types';

export type ArenaStatusVisual = 'stun' | 'freeze' | 'sleep';
export interface ArenaActorPose {
  id: string;
  /** Fractional grid coordinates (between cells while moving; column < 0 when fleeing off-screen). */
  column: number; row: number;
  facing: 1 | -1;
  moving: 'walk' | 'dash' | 'slide' | null;
  hp: number; sp: number;
  statuses: ArenaStatusVisual[];
  statusSinceMs: Partial<Record<ArenaStatusVisual, number>>;
  deadAtMs: number | null;
  fleeing: { sinceMs: number } | null;
}

export const ARENA_DASH_MS = 150;
export const ARENA_SLIDE_MS = 250;
export const ARENA_FLEE_SPEED_CELLS_PER_S = 6;
/** The engine fills a movement gauge by `moveSpeed` per tick and steps at 200. */
const MOVE_GAUGE = 200;
const DEFAULT_MOVE_SPEED = 100;
const STATUS_VISUALS: Record<string, ArenaStatusVisual> = { stun: 'stun', freeze: 'freeze', sleep: 'sleep' };

/** How long one approach step takes on screen at this move speed. */
export function moveDurationMs(moveSpeed: number | null, tickMs: number): number {
  const speed = moveSpeed && moveSpeed > 0 ? moveSpeed : DEFAULT_MOVE_SPEED;
  return (MOVE_GAUGE / speed) * tickMs;
}

interface Step { from: ArenaCell; to: ArenaCell; startMs: number; endMs: number; kind: 'walk' | 'dash' | 'slide' | 'snap' }

/** One actor's recorded state after an event: everything a pose needs, computed once per battle. */
interface StatePoint { t: number; hp: number; sp: number; statusSinceMs: Partial<Record<ArenaStatusVisual, number>>; statuses: ArenaStatusVisual[]; deadAtMs: number | null }
interface ActorIndex { steps: Step[]; states: StatePoint[]; targets: Array<{ t: number; id: string }> }
interface BattleIndex { actors: Map<string, ActorIndex> }
const indices = new WeakMap<ArenaBattle, BattleIndex>();

/** The battle's moves, states and targets per actor, built once (the log never changes). */
function indexOf(battle: ArenaBattle): BattleIndex {
  let index = indices.get(battle);
  if (index) return index;
  const timeOf = (tick: number) => battle.startAtMs + tick * battle.tickMs;
  index = { actors: new Map() };
  for (const def of battle.actors) index.actors.set(def.id, { steps: movementSteps(battle, def.id, def.moveSpeed, timeOf), states: [], targets: [] });
  const running = new Map(battle.actors.map((def) => [def.id, { since: {} as Partial<Record<ArenaStatusVisual, number>>, dead: null as number | null }]));
  for (const e of battle.events) {
    const t = timeOf(e.tick);
    if (e.action === 'target' && e.targetIds[0]) index.actors.get(e.actorId)?.targets.push({ t, id: e.targetIds[0] });
    if (!e.actorStates) continue;
    for (const [id, state] of Object.entries(e.actorStates)) {
      const actor = index.actors.get(id), run = running.get(id);
      if (!actor || !run) continue;
      const ids = (state.statusEffects ?? []).map((x) => String(x.type ?? x.id ?? ''));
      const since: Partial<Record<ArenaStatusVisual, number>> = {};
      for (const visual of Object.values(STATUS_VISUALS)) if (ids.some((x) => STATUS_VISUALS[x] === visual)) since[visual] = run.since[visual] ?? t;
      run.since = since;
      run.dead = state.hp <= 0 ? run.dead ?? t : null;
      actor.states.push({ t, hp: state.hp, sp: state.sp, statusSinceMs: since, statuses: (Object.keys(since) as ArenaStatusVisual[]).sort(), deadAtMs: run.dead });
    }
  }
  indices.set(battle, index);
  return index;
}

/** Index of the last item with t ≤ now (−1 when none). */
function lastAtOrBefore<T extends { t: number }>(items: T[], now: number): number {
  let lo = 0, hi = items.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (items[mid].t <= now) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}

/** Where the steps put an actor at `now`, and whether it is between cells. */
function placeAt(steps: Step[], start: ArenaCell, nowMs: number): { column: number; row: number; moving: ArenaActorPose['moving'] } {
  let column = start.column, row = start.row;
  let moving: ArenaActorPose['moving'] = null;
  for (const step of steps) {
    if (nowMs < step.startMs) break;
    if (nowMs >= step.endMs || step.kind === 'snap') { column = step.to.column; row = step.to.row; moving = null; continue; }
    const f = (nowMs - step.startMs) / (step.endMs - step.startMs);
    column = step.from.column + (step.to.column - step.from.column) * f;
    row = step.from.row + (step.to.row - step.from.row) * f;
    moving = step.kind;
  }
  return { column, row, moving };
}

export function arenaPositions(battle: ArenaBattle, nowMs: number): ArenaActorPose[] {
  const index = indexOf(battle);
  return battle.actors.map((def) => {
    const actor = index.actors.get(def.id)!;
    let { column, row, moving } = placeAt(actor.steps, def.start, nowMs);
    const point = actor.states[lastAtOrBefore(actor.states, nowMs)];
    const hp = point?.hp ?? def.hp, sp = point?.sp ?? def.sp;
    const deadAtMs = point?.deadAtMs ?? null;
    const statuses = point ? point.statuses : [];
    const statusSinceMs = point ? { ...point.statusSinceMs } : {};

    let facing: 1 | -1 = def.team === 'a' ? 1 : -1;
    const targetId = actor.targets[lastAtOrBefore(actor.targets, nowMs)]?.id;
    const target = targetId ? battle.actors.find((a) => a.id === targetId) : null;
    if (target) {
      // The target's settled cell (the last step it has finished).
      const settled = placeAt(index.actors.get(target.id)!.steps.filter((s) => s.endMs <= nowMs), target.start, nowMs).column;
      if (settled !== column) facing = settled > column ? 1 : -1;
    }

    let fleeing: ArenaActorPose['fleeing'] = null;
    if (battle.flee && def.team === 'a' && nowMs >= battle.flee.atMs && deadAtMs === null) {
      const atFlee = placeAt(actor.steps.filter((s) => s.endMs <= battle.flee!.atMs), def.start, battle.flee.atMs);
      column = atFlee.column - ((nowMs - battle.flee.atMs) / 1000) * ARENA_FLEE_SPEED_CELLS_PER_S;
      row = atFlee.row;
      facing = -1; moving = null;
      fleeing = { sinceMs: battle.flee.atMs };
    }
    return { id: def.id, column, row, facing, moving, hp, sp, statuses: [...statuses], statusSinceMs, deadAtMs, fleeing };
  });
}

/** The engine's recorded moves for one actor as on-screen windows. */
function movementSteps(battle: ArenaBattle, id: string, moveSpeed: number | null, timeOf: (tick: number) => number): Step[] {
  const steps: Step[] = [];
  let previousEnd = battle.startAtMs;
  for (const e of battle.events) {
    if (e.action !== 'move' || e.actorId !== id) continue;
    const payload = e.payload as { from?: ArenaCell; to?: ArenaCell; reason?: string };
    if (!payload.from || !payload.to) continue;
    const t = timeOf(e.tick);
    if (payload.reason === 'blinkstrike') steps.push({ from: payload.from, to: payload.to, startMs: t, endMs: t + ARENA_DASH_MS, kind: 'dash' });
    else if (payload.reason === 'push') steps.push({ from: payload.from, to: payload.to, startMs: t, endMs: t + ARENA_SLIDE_MS, kind: 'slide' });
    else if (payload.reason === 'revive') steps.push({ from: payload.from, to: payload.to, startMs: t, endMs: t, kind: 'snap' });
    else {
      // Approach: arrive on the tick, starting no earlier than the previous step ended.
      const duration = Math.min(moveDurationMs(moveSpeed, battle.tickMs), Math.max(0, t - previousEnd));
      steps.push({ from: payload.from, to: payload.to, startMs: t - duration, endMs: t, kind: duration > 0 ? 'walk' : 'snap' });
    }
    previousEnd = steps[steps.length - 1].endMs;
  }
  return steps;
}

export type { ArenaEvent };
