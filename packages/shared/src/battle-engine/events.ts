import type { ActorEvent, ActorEventPayload, BattleActorState } from '../types/group-battle';
/** Events are appended in tick, actor and action order by the simulator. */
export function actorEvent(tick:number,actor:BattleActorState,targets:BattleActorState[],action:string,payload:ActorEventPayload):ActorEvent {
  return {tick,actorId:actor.id,targetIds:targets.map(t=>t.id),action,payload};
}
