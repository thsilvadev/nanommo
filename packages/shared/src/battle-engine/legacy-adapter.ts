import type { ActorEvent, BattleActorProjection } from '../types/group-battle';
export interface LegacyBattleProjectionLog {
  outcome:'win'|'loss';durationTicks:number;
  header:{characterSnapshot:{hp:number;sp:number;position?:number};monsterSnapshot:{hp:number;sp?:number;position?:number}};
  events:Array<{tick:number;actor:'character'|'monster';target?:'character'|'monster';action:string;damage?:number;damageType?:string;hit?:boolean;crit?:boolean;healAmount?:number;spGain?:number;skillId?:string;itemId?:string;hpRemaining?:{character:number;monster:number};spRemaining?:{character:number;monster:number};toPosition?:number}>;
}
/** Historical V1 events remain in their own coordinate system; only identity is adapted. */
export function adaptBattleLogV1(log:LegacyBattleProjectionLog,characterId:string,monsterId:string):{version:1;outcome:'win'|'loss';durationTicks:number;events:ActorEvent[]} {
  const state:Record<string,BattleActorProjection>={
    [characterId]:{hp:log.header.characterSnapshot.hp,sp:log.header.characterSnapshot.sp,position:{row:5,column:log.header.characterSnapshot.position??3},statusEffects:[],targetId:monsterId},
    [monsterId]:{hp:log.header.monsterSnapshot.hp,sp:log.header.monsterSnapshot.sp??0,position:{row:5,column:log.header.monsterSnapshot.position??4},statusEffects:[],targetId:characterId},
  };
  const id=(side:'character'|'monster')=>side==='character'?characterId:monsterId;
  const events:ActorEvent[]=log.events.map(e=>{
    if(e.hpRemaining){state[characterId].hp=e.hpRemaining.character;state[monsterId].hp=e.hpRemaining.monster;}
    if(e.spRemaining){state[characterId].sp=e.spRemaining.character;state[monsterId].sp=e.spRemaining.monster;}
    if(e.action==='move'&&e.toPosition!==undefined)state[id(e.actor)].position.column=e.toPosition;
    return {tick:e.tick,actorId:id(e.actor),targetIds:[id(e.target??(e.actor==='character'?'monster':'character'))],action:e.action,payload:{type:'action',...(e.damage!==undefined?{damage:e.damage}:{}),...(e.damageType?{damageType:e.damageType}:{}),...(e.hit!==undefined?{hit:e.hit}:{}),...(e.crit!==undefined?{crit:e.crit}:{}),...(e.healAmount!==undefined?{healAmount:e.healAmount}:{}),...(e.spGain!==undefined?{spGain:e.spGain}:{}),...(e.skillId?{skillId:e.skillId}:{}),...(e.itemId?{itemId:e.itemId}:{})},actorStates:JSON.parse(JSON.stringify(state))};
  });
  return {version:1,outcome:log.outcome,durationTicks:log.durationTicks,events};
}
