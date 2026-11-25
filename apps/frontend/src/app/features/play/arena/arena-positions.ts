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

export function arenaPositions(battle: ArenaBattle, nowMs: number): ArenaActorPose[] {
  const timeOf = (tick: number) => battle.startAtMs + tick * battle.tickMs;
  return battle.actors.map((def) => {
    const steps = movementSteps(battle, def.id, def.moveSpeed, timeOf);
    // Position: the last step that has started, interpolated inside its window.
    let column = def.start.column, row = def.start.row;
    let moving: ArenaActorPose['moving'] = null;
    for (const step of steps) {
      if (nowMs < step.startMs) break;
      if (nowMs >= step.endMs || step.kind === 'snap') { column = step.to.column; row = step.to.row; continue; }
      const f = (nowMs - step.startMs) / (step.endMs - step.startMs);
      column = step.from.column + (step.to.column - step.from.column) * f;
      row = step.from.row + (step.to.row - step.from.row) * f;
      moving = step.kind;
    }

    let hp = def.hp, sp = def.sp;
    let statusIds: string[] = [];
    const statusSinceMs: Partial<Record<ArenaStatusVisual, number>> = {};
    let deadAtMs: number | null = null;
    let targetId: string | null = null;
    for (const e of battle.events) {
      const t = timeOf(e.tick);
      if (t > nowMs) break;
      if (e.action === 'target' && e.actorId === def.id && e.targetIds[0]) targetId = e.targetIds[0];
      const state = e.actorStates?.[def.id];
      if (!state) continue;
      hp = state.hp; sp = state.sp;
      statusIds = (state.statusEffects ?? []).map((s) => String(s.type ?? s.id ?? ''));
      for (const visual of Object.values(STATUS_VISUALS)) {
        const on = statusIds.some((id) => STATUS_VISUALS[id] === visual);
        if (on) statusSinceMs[visual] ??= t;
        else delete statusSinceMs[visual];
      }
      if (hp <= 0) deadAtMs ??= t;
      else deadAtMs = null;
    }
    const statuses = (Object.keys(statusSinceMs) as ArenaStatusVisual[]).sort();

    let facing: 1 | -1 = def.team === 'a' ? 1 : -1;
    const target = targetId ? battle.actors.find((a) => a.id === targetId) : null;
    if (target) {
      const targetColumn = finalColumnAt(battle, target.id, target.start.column, target.moveSpeed, nowMs, timeOf);
      if (targetColumn !== column) facing = targetColumn > column ? 1 : -1;
    }

    let fleeing: ArenaActorPose['fleeing'] = null;
    if (battle.flee && def.team === 'a' && nowMs >= battle.flee.atMs && deadAtMs === null) {
      const atFlee = arenaPositionAt(battle, def.id, def.start, def.moveSpeed, battle.flee.atMs, timeOf);
      column = atFlee.column - ((nowMs - battle.flee.atMs) / 1000) * ARENA_FLEE_SPEED_CELLS_PER_S;
      row = atFlee.row;
      facing = -1; moving = null;
      fleeing = { sinceMs: battle.flee.atMs };
    }
    return { id: def.id, column, row, facing, moving, hp, sp, statuses, statusSinceMs, deadAtMs, fleeing };
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

function arenaPositionAt(battle: ArenaBattle, id: string, start: ArenaCell, moveSpeed: number | null, nowMs: number, timeOf: (tick: number) => number): ArenaCell {
  let cell = { ...start };
  for (const step of movementSteps(battle, id, moveSpeed, timeOf)) if (step.endMs <= nowMs) cell = { ...step.to };
  return cell;
}

function finalColumnAt(battle: ArenaBattle, id: string, startColumn: number, moveSpeed: number | null, nowMs: number, timeOf: (tick: number) => number): number {
  const def = battle.actors.find((a) => a.id === id)!;
  return arenaPositionAt(battle, id, { row: def.start.row, column: startColumn }, moveSpeed, nowMs, timeOf).column;
}

export type { ArenaEvent };
