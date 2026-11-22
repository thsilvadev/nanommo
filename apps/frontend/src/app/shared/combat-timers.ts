import { combatCooldownDurations, consumableCooldownKey, projectStatusTimeline } from '@nanommo/shared';
import type { SharedBattleView } from '../core/party-projection';

export interface CombatTimer {
  key: string;
  kind: 'status' | 'skill' | 'item';
  id: string;
  remainingSeconds: number;
  fraction: number;
  stacks?: number;
}
export interface CombatTimerDefinitions { items?: Record<string, any>; skills?: Record<string, any> }
export interface CombatTimerInput {
  startAt: string;
  tickDurationMs: number;
  actorId: string;
  snapshot: any;
  events: any[];
  definitions?: CombatTimerDefinitions;
}
const categorySeconds: Record<string, number> = { 'item:potion':10, 'item:tonic':30, 'item:super_tonic':60 };

function statusTimers(statuses: any[], remaining: (status: any) => number): CombatTimer[] {
  const rows = new Map<string, CombatTimer>();
  for (const status of statuses) {
    const id = String(status?.type ?? status?.id ?? '');
    const seconds = remaining(status);
    if (!id || !(seconds > 0)) continue;
    const old = rows.get(id);
    rows.set(id, {key:`status:${id}`,kind:'status',id,remainingSeconds:Math.max(old?.remainingSeconds ?? 0, seconds),fraction:0,stacks:(old?.stacks ?? 0)+Math.max(1,Number(status.stacks ?? 1))});
  }
  return [...rows.values()];
}
function cooldownRows(deadlines: Map<string, {end: number; duration: number}>, now: number): CombatTimer[] {
  return [...deadlines].flatMap(([key, timer]) => {
    const remaining = (timer.end-now)/1000;
    if (!(remaining > 0) || !(timer.duration > 0) || !Number.isFinite(remaining)) return [];
    const kind = key.startsWith('skill:') ? 'skill' : key.startsWith('item:') ? 'item' : null;
    return kind ? [{key,kind,id:key.slice(key.indexOf(':')+1),remainingSeconds:remaining,fraction:Math.min(1,Math.max(0,remaining*1000/timer.duration))}] : [];
  });
}

/** Replays only visible server actions; does not make combat decisions. */
export function projectCombatTimers(input: CombatTimerInput, now: number): CombatTimer[] {
  const start = Date.parse(input.startAt), tickMs = input.tickDurationMs;
  if (!Number.isFinite(start) || !Number.isFinite(now) || !(tickMs > 0) || now < start) return [];
  const tick = Math.floor((now-start)/tickMs);
  const snapshot = input.snapshot ?? {};
  const durations = {...combatCooldownDurations(snapshot,input.definitions?.items),...snapshot.cooldownDurations};
  const deadlines = new Map<string, {end: number; duration: number}>();
  for (const [key, value] of Object.entries(snapshot.cooldowns ?? {})) {
    const ticks = Number(value);
    // Opening state is decremented at tick zero before the first action.
    deadlines.set(key,{end:start+Math.max(0,ticks-1)*tickMs,duration:Number(durations[key] ?? ticks)*tickMs});
  }
  let statuses = snapshot.statusEffects ?? [];
  for (const event of input.events ?? []) {
    if (Number(event.tick) > tick || !Number.isFinite(Number(event.tick))) continue;
    if (Array.isArray(event.actorStates?.[input.actorId]?.statusEffects)) statuses = event.actorStates[input.actorId].statusEffects;
    if ((event.actorId ?? event.actor) !== input.actorId || !['use_skill','use_item'].includes(event.action)) continue;
    const payload = event.payload ?? event;
    let cooldown = payload.cooldown;
    if (!cooldown) {
      if (event.action === 'use_skill' && payload.skillId) {
        const key = `skill:${payload.skillId}`;
        const skill = snapshot.skillDefs?.[payload.skillId] ?? input.definitions?.skills?.[payload.skillId];
        const configured = Number(skill?.cooldownTicks ?? 0);
        cooldown = {key,durationTicks:durations[key] ?? (configured > 0 ? configured+1 : 0)};
      } else if (event.action === 'use_item' && payload.itemId) {
        const item = input.definitions?.items?.[payload.itemId];
        if (item) {
          const key = consumableCooldownKey(item,payload.itemId);
          cooldown = {key,durationTicks:durations[key] ?? 0};
        }
      }
    }
    const ticks = Number(cooldown?.durationTicks ?? 0);
    if (ticks > 0) deadlines.set(cooldown.key,{end:start+(Number(event.tick)+ticks)*tickMs,duration:ticks*tickMs});
  }
  return [...statusTimers(statuses,(status:any) => status.expiresAt ? Math.max(0,(Date.parse(status.expiresAt)-now)/1000) : status.expiresAtTick == null ? Infinity : Math.max(0,(start+Number(status.expiresAtTick)*tickMs-now)/1000)),...cooldownRows(deadlines,now)];
}

export function persistentCombatTimers(source: any, now: number, definitions: CombatTimerDefinitions = {}): CombatTimer[] {
  const durations = {...combatCooldownDurations(source ?? {},definitions.items),...source?.cooldownDurations};
  const deadlines = new Map<string, {end:number;duration:number}>();
  for (const [key, value] of Object.entries(source?.consumableCooldowns ?? {})) {
    const end = Date.parse(String(value));
    const seconds = Number(durations[key])*0.5 || categorySeconds[key] || 0;
    deadlines.set(key,{end,duration:seconds*1000});
  }
  return [...statusTimers(source?.statusEffects ?? [],(status:any) => status.expiresAt ? Math.max(0,(Date.parse(status.expiresAt)-now)/1000) : Infinity),...cooldownRows(deadlines,now)];
}

export function soloCombatTimers(entry: any, target: 'character'|'monster', now: number, definitions: CombatTimerDefinitions = {}): CombatTimer[] {
  const tickMs = Number(entry?.tickDurationMs ?? entry?.log?.header?.tickDurationMs);
  if (!(tickMs > 0)) return [];
  const input = entry.log?.header?.v2Input;
  if (input && Array.isArray(entry.log?.v2Events)) {
    const actor = input.actors?.find((value:any) => target === 'character' ? value.kind === 'character' : value.kind === 'monster');
    if (!actor) return [];
    return projectCombatTimers({startAt:entry.startAt,tickDurationMs:tickMs,actorId:actor.id,snapshot:{...actor.snapshot,skillDefs:{...input.definitions?.skills,...actor.snapshot.skillDefs}},events:entry.log.v2Events,definitions:input.definitions ?? definitions},now);
  }
  const snapshot = entry.log?.header?.[target === 'character' ? 'characterSnapshot' : 'monsterSnapshot'] ?? {};
  const tick = Math.floor((now-Date.parse(entry.startAt))/tickMs);
  const statuses = [...projectStatusTimeline(snapshot.statusEffects,entry.log?.events,target,tick).values()].flat();
  return projectCombatTimers({startAt:entry.startAt,tickDurationMs:tickMs,actorId:target,snapshot:{...snapshot,statusEffects:statuses},events:entry.log?.events ?? [],definitions},now);
}

export function sharedCombatTimers(battle: SharedBattleView, actorId: string, now: number): CombatTimer[] {
  const actor = battle.snapshot.actors.find(value=>value.id===actorId);
  if (!actor) return [];
  return projectCombatTimers({startAt:battle.startAt,tickDurationMs:battle.snapshot.tickDurationMs??500,actorId,snapshot:actor.snapshot,events:battle.log.events},now);
}
