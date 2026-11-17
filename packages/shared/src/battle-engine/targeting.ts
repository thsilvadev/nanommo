import type { BattleActor, BattleActorState, BattleDefinitionsV2, GroupGambitAction, GroupGambitLine } from '../types/group-battle';
import type { CombatantSnapshot, GambitGaugeType } from './index';
import { GambitEvaluator } from './index';
import { findGridPathToRange, gridDistance, gridDistanceField, gridKey } from './grid';
export const actionParams=(action:GroupGambitAction):Record<string,string|number|undefined>=>({...action,...action.params}) as Record<string,string|number|undefined>;
export function actorDistance(self:BattleActorState,target:BattleActorState,states:BattleActorState[]):number {
  if(self.id===target.id) return 0;
  const ranged=self.combatStyle==='ranged'||self.basicAttackDamageType==='ranged'||Number(self.basicAttackRange??0)>0;
  if(ranged) return Math.max(0,gridDistance(self.position,target.position)-1);
  const path=findGridPathToRange(self.position,target.position,states.filter(s=>s.hp>0&&s.id!==self.id).map(s=>s.position),1);
  return path?.length??Infinity;
}
function snapshot(s:BattleActorState):CombatantSnapshot {return {...s,position:s.position.column,characterId:s.id};}
export interface TargetedGambitChoice { action:GroupGambitAction; line:GroupGambitLine; target:BattleActorState }
/** All conditions constrain one candidate; selector conditions order the surviving set. */
export function selectGroupGambit(actor:BattleActor,self:BattleActorState,states:BattleActorState[],gauge:GambitGaugeType,definitions:BattleDefinitionsV2,random:()=>number):TargetedGambitChoice|null {
  const lines=GambitEvaluator.normalizeGambitPage(actor.gambits).lines;
  let rangedForChoice=false;let field:Map<string,number>|undefined;const distanceCache=new Map<string,number>();
  const candidateDistance=(target:BattleActorState):number=>{
    if(target.id===self.id)return 0;
    const cached=distanceCache.get(target.id);if(cached!==undefined)return cached;
    let distance=Infinity;
    if(rangedForChoice)distance=Math.max(0,gridDistance(self.position,target.position)-1);
    else {
      field??=gridDistanceField(self.position,states.filter(s=>s.hp>0&&s.id!==self.id).map(s=>s.position));
      for(let row=Math.max(0,target.position.row-1);row<=Math.min(9,target.position.row+1);row++)for(let column=Math.max(0,target.position.column-1);column<=Math.min(9,target.position.column+1);column++)distance=Math.min(distance,field.get(gridKey({row,column}))??Infinity);
    }
    distanceCache.set(target.id,distance);return distance;
  };
  for(const line of [...lines].sort((a,b)=>(a.priority??999)-(b.priority??999))) {
    const action:GroupGambitAction=line.action;if(gauge==='attack'?action.id!=='attack':!['use_skill','use_item'].includes(action.id??''))continue;
    const params=actionParams(action);const skill=self.skillDefs?.[String(params.skillId)]??definitions.skills?.[String(params.skillId)];const item=definitions.items?.[String(params.itemId)];
    rangedForChoice=action.id==='use_skill'?skill?.ranged===true:self.combatStyle==='ranged'||self.basicAttackDamageType==='ranged'||Number(self.basicAttackRange??0)>0;
    const conditions=line.conditions??[];const conditionScope=conditions.map((c:any)=>String(c.id??'')).find((s:string)=>/^(ally|foe|self)_/.test(s))?.split('_')[0];
    const scope=action.id==='attack'?'foe':skill?.target??(item?.effect?.type==='revive_ally'||item?.effect?.type==='revive_half'?'ally':conditionScope??'self');
    const revive=item?.effect?.type==='revive_ally'||item?.effect?.type==='revive_half'||item?.effect?.type==='revive_full_cleanse';
    let candidates=states.filter(s=>scope==='self'?s.id===self.id:scope==='ally'?s.team===self.team:s.team!==self.team).filter(s=>revive?s.hp<=0:s.hp>0);
    if(action.id==='use_item'&&revive&&self.hp<=0&&item?.effect?.type!=='revive_full_cleanse')continue;
    const legalitySelf=snapshot(self);
    // An ally revive consumes the acting character's stock; Fairy remains self-only.
    const legal=GambitEvaluator.isActionLegal(action,legalitySelf,self.inventory,definitions.items??{});
    if(!legal)continue;
    candidates=candidates.filter(candidate=>conditions.every((condition:any)=>{
      const id=String(condition.id??''); if(id==='upon_death')return self.hp<=0;
      if(/_(lowest|highest|nearest|furthest)/.test(id))return true;
      if(id==='foe_in_range')return Math.max(0,gridDistance(self.position,candidate.position)-1)===Number(condition.params?.value??condition.value);
      if(id==='ally_targeted_by_foe')return states.some(s=>s.team!==self.team&&s.hp>0&&s.targetId===candidate.id);
      if(id==='ally_targeted_by_ally')return states.some(s=>s.team===self.team&&s.id!==candidate.id&&s.hp>0&&s.targetId===candidate.id);
      if(id==='foe_targeting_self')return candidate.targetId===self.id;
      if(id==='foe_targeting_leader')return candidate.targetId===(self.partyLeaderId??self.id);
      if(id==='foe_party_leader_target'){const leader=states.find(s=>s.id===(self.partyLeaderId??self.id));return candidate.id===leader?.targetId;}
      if(id==='foe_not_targeted_by_ally')return !states.some(s=>s.team===self.team&&s.id!==self.id&&s.targetId===candidate.id);
      const subject=id.startsWith('ally_')?snapshot(candidate):snapshot(self);
      return GambitEvaluator.evaluateCondition(condition,subject,snapshot(candidate),self.inventory);
    }));
    if(!candidates.length)continue;
    const selector=conditions.map((c:any)=>String(c.id??'')).find((s:string)=>/_(lowest|highest|nearest|furthest)/.test(s));
    const value=(s:BattleActorState):number=>{
      if(!selector)return candidateDistance(s);
      if(selector.endsWith('nearest')||selector.endsWith('furthest'))return candidateDistance(s);
      if(selector==='ally_lowest_hp')return s.maxHp>0?s.hp/s.maxHp:0;
      const stat=selector.replace(/^(ally|foe)_(highest|lowest)_/,'');
      return Number((({hp:s.hp,mp:s.sp,max_hp:s.maxHp,max_mp:s.maxSp,matk:s.matk,def:s.def,defense:s.def,mdef:s.mdefPercent,speed:s.moveSpeed??0}) as Record<string,number>)[stat]??0);
    };
    const descending=selector?.includes('highest')||selector?.endsWith('furthest');
    candidates.sort((a,b)=>{const av=value(a),bv=value(b);const diff=av===bv?0:(av<bv?-1:1);return (descending?-diff:diff)||(a.id<b.id?-1:1);});
    const randomKo=conditions.some((c:any)=>String(c.id)==='ally_has_status'&&String(c.params?.status??c.status).toLowerCase()==='ko');
    const target=randomKo?candidates[Math.floor(random()*candidates.length)]:candidates[0];
    return {action,line,target};
  }
  return null;
}
