/** Public battle projection: replay server events by time, without predicting outcomes. */
export interface SharedActor {
  id: string; kind: string; team: string; name?: string; monsterId?: string; definitionId?: string;
  /** Deployment cell (sent by the API). */
  position?: { row: number; column: number };
  /** Characters: how they look in the arena (null when the character has no appearance yet). */
  look?: import('../features/play/arena/arena-battle').SharedActorLook | null;
  snapshot: { atk?: number; matk?: number; def?: number; mdefPercent?: number; accuracy?: number; evasion?: number; critChance?: number; name?: string; hp: number; sp: number; maxHp: number; maxSp: number; cooldowns?:Record<string,number>; cooldownDurations?:Record<string,number>; statusEffects?: Array<{ id?: string; type?: string; stacks?: number; expiresAtTick?:number; expiresAt?:string }> };
}
export interface SharedActorState { hp: number; sp: number; targetId?: string; statusEffects?: Array<{id?:string;type?:string;stacks?:number}> }
export interface SharedEvent {
  actorStates?: Record<string, SharedActorState>;
  tick: number; actorId: string; targetIds: string[]; action: string;
  payload?: Record<string, any>;
}
export interface SharedBattleView {
  id: string; revision: number; startAt: string; endAt: string; state: string; mapId?: string;
  snapshot: { actors: SharedActor[]; tickDurationMs?: number };
  log: { events: SharedEvent[]; durationTicks?: number };
}
export function visibleSharedEvents(battle: SharedBattleView, now: number): SharedEvent[] {
  const tick = Math.floor((now - Date.parse(battle.startAt)) / (battle.snapshot.tickDurationMs ?? 500));
  return (battle.log?.events ?? []).filter(event => event.tick <= tick);
}
export function sharedActorResources(battle: SharedBattleView, actorId: string, now: number): { hp: number; sp: number } | null {
  const actor = battle.snapshot.actors.find(value => value.id === actorId);
  if (!actor) return null;
  let hp = actor.snapshot.hp, sp = actor.snapshot.sp;
  for (const event of visibleSharedEvents(battle, now)) {
    const state = event.actorStates?.[actorId];
    if (state) { hp = state.hp; sp = state.sp; continue; }
    const payload = event.payload ?? {};
    if (Number.isFinite(payload['hpRemaining']?.[actorId])) hp = Number(payload['hpRemaining'][actorId]);
    if (Number.isFinite(payload['spRemaining']?.[actorId])) sp = Number(payload['spRemaining'][actorId]);
  }
  return { hp, sp };
}
export function sharedCurrentTarget(battle: SharedBattleView, actorId: string, now: number): string | null {
  let target: string|null = null;
  for (const event of visibleSharedEvents(battle, now)) {
    if (event.actorStates?.[actorId]) target = event.actorStates[actorId].targetId ?? null;
    else if (event.actorId === actorId && event.targetIds?.length && ['attack','use_skill','cast_start','target_changed'].includes(event.action)) target = event.targetIds[0];
  }
  return target;
}

export interface TeleportActivity { elapsedMs: number; lastAccruedAt: string | number; paused: boolean }
/** The teleport under way (the group's, else my saved-town teleport intent), or null. A teleport takes 10 s of unpaused time. */
export function teleportActivityOf(party: { teleport?: TeleportActivity | null } | null | undefined, character: { travelIntent?: any } | null | undefined): TeleportActivity | null {
  if (party?.teleport) return party.teleport;
  const intent = character?.travelIntent;
  if (!intent || !['saved-town-teleport', 'saved-town-route-teleport'].includes(intent.kind)) return null;
  return { elapsedMs: Number(intent.segmentProgress ?? 0) * 10_000, lastAccruedAt: intent.lastAccruedAt, paused: intent.waitingForBattle === true };
}
/** When an unpaused teleport started (its accrued time counted back from the last accrual), or null while paused/unknown. */
export function teleportStartedAtMs(activity: TeleportActivity | null): number | null {
  if (!activity || activity.paused) return null;
  const last = typeof activity.lastAccruedAt === 'number' ? activity.lastAccruedAt : Date.parse(activity.lastAccruedAt);
  return Number.isFinite(last) ? last - Number(activity.elapsedMs ?? 0) : null;
}
export function teleportProgress(teleport: {elapsedMs:number;lastAccruedAt:string|number;paused:boolean}, now:number): number {
  const last=typeof teleport.lastAccruedAt==='number'?teleport.lastAccruedAt:Date.parse(teleport.lastAccruedAt);
  const accrued=teleport.paused || !Number.isFinite(last) ? 0 : Math.max(0,now-last);
  return Math.max(0,Math.min(100,(Number(teleport.elapsedMs??0)+accrued)/100));
}

export function sharedActorStatuses(battle: SharedBattleView, actorId:string, now:number): Array<{id?:string;type?:string;stacks?:number}> {
  let effects=battle.snapshot.actors.find(actor=>actor.id===actorId)?.snapshot.statusEffects??[];
  for(const event of visibleSharedEvents(battle,now)) if(event.actorStates?.[actorId]?.statusEffects) effects=event.actorStates[actorId].statusEffects!;
  return effects;
}

export function isSharedBattleCurrent(battle: SharedBattleView|null,now:number):boolean { return !!battle && ['scheduled','started'].includes(battle.state) && now<Date.parse(battle.endAt); }
