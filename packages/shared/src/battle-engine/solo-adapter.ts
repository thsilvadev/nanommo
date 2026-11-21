import { BattleEngine, CombatantSnapshot } from './index';
import { placeBattleActors } from './actors';
import { replayBattleV2, simulateBattleV2 } from './group-simulator';
import type { ActorEvent, BattleInputV2, BattleResultV2 } from '../types/group-battle';

type LegacyOptions=NonNullable<Parameters<typeof BattleEngine.simulateBattle>[4]>;
export type SoloBattleResultV2=ReturnType<typeof BattleEngine.simulateBattle>&{v2Input:BattleInputV2;v2Result:BattleResultV2};
/** New solo encounters use the multi-actor executor while existing consumers can read their legacy view. */
export function simulateBattleV2Solo(
  characterSnapshot:CombatantSnapshot,
  monsterDefinition:Parameters<typeof BattleEngine.simulateBattle>[1],
  gambitPage:Parameters<typeof BattleEngine.simulateBattle>[2],
  seed:string,
  options:LegacyOptions&{maxTicks?:number;persistedInput?:BattleInputV2}={},
):SoloBattleResultV2 {
  const characterId=options.persistedInput?.actors.find(actor=>actor.kind==='character')?.id??characterSnapshot.characterId??'character';const monsterId=options.persistedInput?.actors.find(actor=>actor.kind==='monster')?.id??`monster:${String(monsterDefinition.id??'monster')}:0`;
  const monsterSnapshot=options.persistedInput?.actors.find(actor=>actor.id===monsterId)?.snapshot??{...BattleEngine.buildMonsterSnapshot(monsterDefinition),skills:options.monsterSkillDefs??{},skillDefs:options.monsterSkillDefs??{}};
  const input:BattleInputV2=options.persistedInput??{version:2,elementalRulesVersion:characterSnapshot.elementalRulesVersion??1,seed,tickDurationMs:500,definitions:{items:options.itemDefinitions??{},skills:options.monsterSkillDefs??{},statuses:options.statusEffectDefs??{}},regenTickOffset:options.regenTickOffset??0,...(options.maxTicks!==undefined?{maxTicks:options.maxTicks}:{}),actors:placeBattleActors([
    {id:characterId,kind:'character',team:'a',position:{row:5,column:0},snapshot:{...characterSnapshot,isPlayerCharacter:true},gambits:gambitPage,inventory:{...options.inventory},name:characterSnapshot.characterName??characterId},
    {id:monsterId,kind:'monster',team:'b',position:{row:5,column:9},snapshot:monsterSnapshot,gambits:monsterDefinition.gambit??[],inventory:{},name:monsterDefinition.name??monsterDefinition.id,definitionId:monsterDefinition.id,principalActorId:characterId,encounterRole:'principal',attackIntervalTicks:monsterDefinition.atkSpeedTicks,damageTakenMultiplier:monsterDefinition.damageTakenMultiplier,weaponCategoryDamageTakenMultiplier:monsterDefinition.weaponCategoryDamageTakenMultiplier},
  ])};
  const result=options.stopAfterTick!==undefined?replayBattleV2(input,options.stopAfterTick):simulateBattleV2(input);
  if(result.termination==='limit')throw new Error('V2 battle exceeded execution limit without resolving');
  const self=result.actorsAfter[characterId];const foe=result.actorsAfter[monsterId];
  const events=result.events.map(event=>{
    const payload=event.payload;const actor=event.actorId===characterId?'character':'monster';const target=event.targetIds[0]===characterId?'character':'monster';
    const state=event.actorStates??{};
    const base={tick:event.tick,actor,target,action:event.action,actorId:event.actorId,targetIds:event.targetIds,hpRemaining:{character:state[characterId]?.hp??self.hp,monster:state[monsterId]?.hp??foe.hp},spRemaining:{character:state[characterId]?.sp??self.sp,monster:state[monsterId]?.sp??foe.sp}};
    if(payload.type==='action'){const {type,...action}=payload;return {...base,...action};}
    if(payload.type==='status'){const {type,statusId,...status}=payload;return {...base,...status,...(payload.sourceActor?{actor:payload.sourceActor}:{}),status:statusId,statusEffects:state[event.targetIds[0]]?.statusEffects};}
    if(payload.type==='cast')return {...base,skillId:payload.skillId,resolvesAtTick:payload.resolvesAtTick};
    if(payload.type==='move')return {...base,fromPosition:payload.from.column,toPosition:payload.to.column,fromGridPosition:payload.from,toGridPosition:payload.to,reason:payload.reason};
    if(payload.type==='regen')return {...base,hpGain:payload.hpGain,spGain:payload.spGain};
    return base;
  });
  const startingSelf=input.actors.find(a=>a.id===characterId)!;const startingFoe=input.actors.find(a=>a.id===monsterId)!;
  return {outcome:result.outcome,durationTicks:result.durationTicks,hpAfter:self.hp,spAfter:self.sp,inventoryAfter:{...self.inventory},itemsConsumed:self.itemsConsumed.map(i=>({...i})),foodBuffAfter:[...self.foodBuffs??[]].sort((a,b)=>b.remainingTicks-a.remainingTicks)[0],foodBuffsAfter:(self.foodBuffs??[]).map(b=>({...b})),foodDigestRemainingTicksByItem:{...self.foodDigestRemainingTicksByItem},statusEffectsAfter:(self.statusEffects??[]).map(s=>({...s})),cooldownsAfter:{...self.cooldowns},
    log:{header:{engineVersion:2,monsterId:monsterDefinition.id??null,seedUsed:seed,characterSnapshot:{...characterSnapshot,position:startingSelf.position.column,gridPosition:startingSelf.position},monsterSnapshot:{...monsterSnapshot,position:startingFoe.position.column,gridPosition:startingFoe.position},v2Input:input},events,v2Events:result.events,finalPositions:{character:self.position.column,monster:foe.position.column},outcome:result.outcome,durationTicks:result.durationTicks},
    checkpoint:options.stopAfterTick!==undefined?{tick:Math.max(0,result.durationTicks-1),hp:self.hp,sp:self.sp,monsterHp:foe.hp,monsterSp:foe.sp,statusEffects:self.statusEffects??[],monsterStatusEffects:foe.statusEffects??[],cooldowns:{...self.cooldowns},foodBuffs:self.foodBuffs??[],foodDigestRemainingTicksByItem:{...self.foodDigestRemainingTicksByItem},inventoryAfter:{...self.inventory},battleEnded:result.ended}:undefined,
    v2Input:input,v2Result:result,
  };
}
