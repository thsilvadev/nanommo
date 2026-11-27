/**
 * What each combatant is doing at `nowMs` (swing, cast, flinch, stun, death),
 * the arrow in flight, and the floating numbers / flashes on screen — the
 * same timing rules as the Character Summary portrait and the grind-panel
 * monster, generalised to any actor of a V2 log. Pure, like arena-positions.
 */
import { ARROW_FLIGHT_SECONDS, BOW_RELEASE_FRACTION, CLIP_SECONDS, type AnimationState, type HitClip } from '../../../shared/character-animation/animation-state';
import { MONSTER_ATTACK_LEAD_MS, MONSTER_IMPACT_FRACTION } from '../../../shared/monster-viewer/monster-animation-state';
import { damageFeedbackStyle, flashColor, type ArenaFlash, type DamageFeedbackStyle } from '../../../shared/battle-feedback-style';
import { arenaPositions, type ArenaActorPose } from './arena-positions';
import type { ArenaActorDef, ArenaBattle, ArenaEvent } from './arena.types';

export interface ArenaFeedback { key: string; targetId: string; atMs: number; text: string; style: DamageFeedbackStyle | 'heal' | 'miss'; flash: ArenaFlash | null }
export interface ArenaCastBar { startedAtMs: number; endsAtMs: number; skillId: string }
export interface ArenaProjectile { fromId: string; toId: string; launchAtMs: number; hitAtMs: number }
export interface ArenaActorFrame extends ArenaActorPose {
  anim: AnimationState;
  cast: ArenaCastBar | null;
  projectile: ArenaProjectile | null;
  /** 0..1 while leaving the scene after a battle (set by arena-phase), absent otherwise. */
  exit?: number;
  /** Teleporting since this instant: kneeling inside a column of blue light (set by arena-phase). */
  teleport?: { startedAtMs: number };
}
export interface ArenaFrame { actors: ArenaActorFrame[]; feedback: ArenaFeedback[]; wiped: boolean; ended: boolean }

export const ARENA_FEEDBACK_MS = 1100;
const STRIKES = new Set(['attack', 'use_skill']);
const DAMAGING = new Set(['attack', 'use_skill', 'splash', 'use_item', 'reflect']);
const DOT = new Set(['status_tick', 'status_damage']);

interface ActionIndex { battleStartMs: number; actions: Map<string, Action[]>; hits: Map<string, Array<{ t: number; tick: number }>>; feedback: ArenaFeedback[] }
const indices = new WeakMap<ArenaBattle, ActionIndex>();
/** Actions, hits taken and every floating number of a battle, built once (the log never changes). */
function indexOf(battle: ArenaBattle): ActionIndex {
  let index = indices.get(battle);
  if (index) return index;
  const timeOf = (tick: number) => battle.startAtMs + tick * battle.tickMs;
  const actions = new Map(battle.actors.map((def) => [def.id, actionsOf(battle, def.id, timeOf)]));
  const hits = new Map<string, Array<{ t: number; tick: number }>>(battle.actors.map((def) => [def.id, []]));
  for (const e of battle.events) {
    if (DOT.has(e.action) || Number(e.payload?.['damage'] ?? 0) <= 0) continue;
    for (const id of e.targetIds) if (id !== e.actorId) hits.get(id)?.push({ t: timeOf(e.tick), tick: e.tick });
  }
  index = { battleStartMs: battle.startAtMs, actions, hits, feedback: allFeedback(battle, timeOf) };
  indices.set(battle, index);
  return index;
}
function lastAtOrBefore<T extends { t: number }>(items: T[], now: number): number {
  let lo = 0, hi = items.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (items[mid].t <= now) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}

export function projectArenaBattle(battle: ArenaBattle, nowMs: number): ArenaFrame {
  const index = indexOf(battle);
  const poses = arenaPositions(battle, nowMs);
  const actors = battle.actors.map((def, i) => frameOf(def, poses[i], nowMs, index));
  const teamA = actors.filter((a) => battle.actors.find((d) => d.id === a.id)!.team === 'a');
  return {
    actors,
    feedback: feedbackAt(index.feedback, nowMs),
    wiped: teamA.length > 0 && teamA.every((a) => a.deadAtMs !== null && a.deadAtMs <= nowMs),
    ended: nowMs >= battle.endAtMs || (battle.flee !== null && nowMs >= battle.flee.atMs),
  };
}

interface Action { startsAtMs: number; strikesAtMs: number; casts: boolean; strikes: boolean; skillId: string; attack: boolean; targetId: string | null }

/** One actor's attacks and skills in time order: `cast_start` opens a cast resolved by its next use_skill (or cast_fizzle). */
function actionsOf(battle: ArenaBattle, id: string, timeOf: (tick: number) => number): Action[] {
  const out: Action[] = [];
  let open: { tick: number; skillId: string; resolvesAtTick: number | null } | null = null;
  for (const e of battle.events) {
    if (e.actorId !== id) continue;
    if (e.action === 'cast_start') {
      open = { tick: e.tick, skillId: String(e.payload['skillId'] ?? ''), resolvesAtTick: Number.isFinite(Number(e.payload['resolvesAtTick'])) ? Number(e.payload['resolvesAtTick']) : null };
      continue;
    }
    if (e.action === 'cast_fizzle') {
      if (open && open.tick < e.tick) out.push({ startsAtMs: timeOf(open.tick), strikesAtMs: timeOf(e.tick), casts: true, strikes: false, skillId: open.skillId, attack: false, targetId: null });
      open = null;
      continue;
    }
    if (!STRIKES.has(e.action)) continue;
    const castFrom = e.action === 'use_skill' && open && open.tick < e.tick ? open : null;
    open = null;
    out.push({
      startsAtMs: timeOf(castFrom?.tick ?? e.tick), strikesAtMs: timeOf(e.tick), casts: !!castFrom, strikes: true,
      skillId: String(e.payload['skillId'] ?? castFrom?.skillId ?? ''), attack: e.action === 'attack', targetId: e.targetIds[0] ?? null,
    });
  }
  // A cast still open at the end of the log (or of what is known) resolves at its announced tick.
  if (open && open.resolvesAtTick !== null) out.push({ startsAtMs: timeOf(open.tick), strikesAtMs: timeOf(open.resolvesAtTick), casts: true, strikes: false, skillId: open.skillId, attack: false, targetId: null });
  return out.sort((a, b) => a.strikesAtMs - b.strikesAtMs);
}

function frameOf(def: ArenaActorDef, pose: ArenaActorPose, nowMs: number, index: ActionIndex): ArenaActorFrame {
  const actions = index.actions.get(def.id) ?? [];
  const casting = actions.find((a) => a.casts && a.startsAtMs <= nowMs && nowMs < a.strikesAtMs) ?? null;
  const cast: ArenaCastBar | null = casting && pose.deadAtMs === null ? { startedAtMs: casting.startsAtMs, endsAtMs: casting.strikesAtMs, skillId: casting.skillId } : null;
  const projectile = def.attackStyle === 'bow' ? arrowAt(def.id, actions, nowMs) : null;

  const base: AnimationState['base'] = pose.fleeing || pose.moving === 'dash' ? 'Sprint' : pose.moving === 'walk' ? 'Walk' : 'CombatIdle';
  if (pose.deadAtMs !== null && nowMs >= pose.deadAtMs) {
    return { ...pose, anim: { base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: pose.deadAtMs, speed: 1 } }, cast: null, projectile: null };
  }
  const anim: AnimationState = { base };
  const disabled = pose.statusSinceMs.stun ?? pose.statusSinceMs.sleep;
  if (disabled !== undefined) {
    anim.oneShot = { clip: 'Stun', startedAtMs: disabled, speed: 1 };
    anim.freezeAtMs = disabled;
  } else if (cast) {
    anim.cast = { startedAtMs: cast.startedAtMs, endsAtMs: cast.endsAtMs };
  } else if (!pose.fleeing) {
    const swing = def.kind === 'monster' ? monsterSwing(actions, index.battleStartMs, def.attackStyle, nowMs) : characterSwing(actions, def.attackStyle, nowMs);
    if (swing) anim.oneShot = swing;
  }
  if (pose.statusSinceMs.freeze !== undefined) anim.freezeAtMs = Math.min(anim.freezeAtMs ?? Infinity, pose.statusSinceMs.freeze);

  const hits = index.hits.get(def.id) ?? [];
  const hit = hits[lastAtOrBefore(hits, nowMs)];
  if (hit) {
    const clip: HitClip = def.kind === 'monster' || hit.tick % 2 === 0 ? 'Damage' : 'Damage2';
    const startedAtMs = hit.t;
    if (nowMs < startedAtMs + CLIP_SECONDS[clip] * 1000) anim.hit = { clip, startedAtMs };
  }
  return { ...pose, anim, cast, projectile };
}

/** Character rules (animation-state.ts): a melee swing starts on its hit, sped up to end before the next action; a bow shot opens early so the arrow lands on the hit. */
function characterSwing(actions: Action[], style: ArenaActorDef['attackStyle'], nowMs: number): AnimationState['oneShot'] | null {
  const draw = CLIP_SECONDS.Attack * BOW_RELEASE_FRACTION;
  const shots = actions.filter((a) => a.strikes).map((strike) => {
    if (style === 'bow' && !strike.casts) {
      const previous = actions.filter((a) => a.strikesAtMs < strike.strikesAtMs).pop();
      const room = previous ? (strike.strikesAtMs - previous.strikesAtMs) / 1000 - ARROW_FLIGHT_SECONDS : Infinity;
      const speed = room < draw ? draw / Math.max(room, 0.05) : 1;
      return { startedAtMs: strike.strikesAtMs - (draw / speed + ARROW_FLIGHT_SECONDS) * 1000, speed };
    }
    const next = actions.find((a) => a.startsAtMs > strike.strikesAtMs);
    const interval = next ? (next.startsAtMs - strike.strikesAtMs) / 1000 : Infinity;
    return { startedAtMs: strike.strikesAtMs, speed: interval < CLIP_SECONDS.Attack ? CLIP_SECONDS.Attack / interval : 1 };
  });
  const shot = shots.filter((s) => s.startedAtMs <= nowMs).pop();
  return shot && nowMs < shot.startedAtMs + (CLIP_SECONDS.Attack / shot.speed) * 1000 ? { clip: 'Attack', ...shot } : null;
}

/**
 * Monster rules (monster-animation-state.ts): the swing leads its hit by MONSTER_ATTACK_LEAD_MS (never
 * before the previous action) and the blow sits at MONSTER_IMPACT_FRACTION of the window. Expressed as an
 * Attack one-shot whose window is [startedAtMs, startedAtMs + Attack/speed]; MonsterModel maps it onto
 * the species' own clip. Bow monsters shoot like characters.
 */
function monsterSwing(actions: Action[], battleStartMs: number, style: ArenaActorDef['attackStyle'], nowMs: number): AnimationState['oneShot'] | null {
  if (style === 'bow') return characterSwing(actions, style, nowMs);
  let previousImpact = battleStartMs;
  let current: { startedAtMs: number; endsAtMs: number } | null = null;
  for (const a of actions) {
    if (a.strikes && !a.casts) {
      const start = Math.max(a.strikesAtMs - MONSTER_ATTACK_LEAD_MS, previousImpact);
      const lead = Math.max(50, a.strikesAtMs - start);
      const window = { startedAtMs: a.strikesAtMs - lead, endsAtMs: a.strikesAtMs + (lead * (1 - MONSTER_IMPACT_FRACTION)) / MONSTER_IMPACT_FRACTION };
      if (window.startedAtMs <= nowMs && nowMs < window.endsAtMs) current = window;
    }
    previousImpact = a.strikesAtMs;
  }
  if (!current) return null;
  return { clip: 'Attack', startedAtMs: current.startedAtMs, speed: CLIP_SECONDS.Attack / Math.max(0.05, (current.endsAtMs - current.startedAtMs) / 1000) };
}

function arrowAt(fromId: string, actions: Action[], nowMs: number): ArenaProjectile | null {
  for (const a of actions) {
    if (!a.attack || !a.targetId) continue;
    const launchAtMs = a.strikesAtMs - ARROW_FLIGHT_SECONDS * 1000;
    if (launchAtMs <= nowMs && nowMs < a.strikesAtMs) return { fromId, toId: a.targetId, launchAtMs, hitAtMs: a.strikesAtMs };
  }
  return null;
}

/** Every floating number of the battle, in time order. */
function allFeedback(battle: ArenaBattle, timeOf: (tick: number) => number): ArenaFeedback[] {
  const team = new Map(battle.actors.map((a) => [a.id, a.team]));
  const out: ArenaFeedback[] = [];
  battle.events.forEach((e: ArenaEvent, index) => {
    const atMs = timeOf(e.tick);
    const p = e.payload ?? {};
    const targetId = e.targetIds[0] ?? e.actorId;
    const own = team.get(targetId) === 'a';
    const key = `${e.tick}:${index}:${targetId}`;
    if (DOT.has(e.action) && Number(p['damage'] ?? 0) > 0) {
      const status = String(p['statusId'] ?? '');
      const style = damageFeedbackStyle({ action: 'status_damage', status });
      out.push({ key, targetId, atMs, text: String(Math.floor(Number(p['damage']))), style, flash: flashColor({ action: e.action, status }, own) });
    } else if (DAMAGING.has(e.action) && p['hit'] === false) {
      out.push({ key, targetId, atMs, text: 'Miss', style: 'miss', flash: null });
    } else if (DAMAGING.has(e.action) && Number(p['damage'] ?? 0) > 0) {
      const style: DamageFeedbackStyle = own ? 'character-damage' : p['crit'] === true ? 'critical' : 'monster-damage';
      out.push({ key, targetId, atMs, text: String(Math.floor(Number(p['damage']))), style, flash: flashColor({ action: e.action, crit: p['crit'] === true }, own) });
    } else if (Number(p['healAmount'] ?? 0) > 0) {
      out.push({ key, targetId, atMs, text: `+${Math.floor(Number(p['healAmount']))}`, style: 'heal', flash: null });
    }
  });
  return out;
}

/** The numbers on screen at `now` (shown for ARENA_FEEDBACK_MS after they appear). */
function feedbackAt(all: ArenaFeedback[], nowMs: number): ArenaFeedback[] {
  let lo = 0, hi = all.length - 1, last = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (all[mid].atMs <= nowMs) { last = mid; lo = mid + 1; } else hi = mid - 1; }
  const out: ArenaFeedback[] = [];
  for (let i = last; i >= 0 && nowMs - all[i].atMs < ARENA_FEEDBACK_MS; i--) out.unshift(all[i]);
  return out;
}
