import type { BattleActor, BattleActorState, BattleDefinitionsV2, GroupGambitAction, GroupGambitLine } from '../types/group-battle';
import type { CombatantSnapshot, GambitGaugeType } from './index';
import { activeGambitLines } from './active-gambits';
import { GambitEvaluator } from './index';
import { itemTargetError, legacyItemTarget, GAMBIT_ITEM_TARGETS, type GambitItemTarget } from './item-target';
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
export function selectGroupGambit(actor:BattleActor,self:BattleActorState,states:BattleActorState[],gauge:GambitGaugeType,definitions:BattleDefinitionsV2,random:()=>number,elementalRulesVersion:0|1=1):TargetedGambitChoice|null {
  const lines=GambitEvaluator.normalizeGambitPage(activeGambitLines(actor.gambits)).lines;
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
    const conditions=line.conditions??[];
    const hasAllyCondition=conditions.some((condition:any)=>String(condition.id??'').startsWith('ally_'));
    // use_item: an explicit target (self/ally/foe) follows the shared rules; lines saved before it keep the legacy choice.
    const explicitItemTarget=action.id==='use_item'&&GAMBIT_ITEM_TARGETS.includes(params.target as GambitItemTarget)?params.target as GambitItemTarget:null;
    if(action.id==='use_item'&&params.target!==undefined&&(!explicitItemTarget||itemTargetError(explicitItemTarget,conditions[0],item)))continue;
    const actionScope=action.id==='attack'?'foe':action.id==='use_item'?(explicitItemTarget??legacyItemTarget(conditions.map((c:any)=>String(c.id??'')),item?.effect?.type)):skill?.target??(hasAllyCondition?'ally':'self');
    const revive=item?.effect?.type==='revive_ally'||item?.effect?.type==='revive_half'||item?.effect?.type==='revive_full_cleanse';
    let candidates=states.filter(s=>actionScope==='self'?s.id===self.id:actionScope==='ally'?s.team===self.team:s.team!==self.team).filter(s=>revive?s.hp<=0:s.hp>0);
    if(action.id==='use_item'&&revive&&self.hp<=0&&item?.effect?.type!=='revive_full_cleanse')continue;
    if(!GambitEvaluator.isActionLegal(action,snapshot(self),self.inventory,definitions.items??{}))continue;
    const grouped={self:[] as any[],ally:[] as any[],foe:[] as any[]};
    for(const condition of conditions){const id=String(condition.id??'');const scope=id.startsWith('ally_')?'ally':id.startsWith('foe_')?'foe':'self';grouped[scope].push(condition);}
    const matches=(condition:any,subject:BattleActorState):boolean=>{
      const id=String(condition.id??''); if(id==='upon_death')return self.hp<=0;
      if(/_(lowest|highest|nearest|furthest)/.test(id))return true;
      if(id==='foe_in_range')return Math.max(0,gridDistance(self.position,subject.position)-1)===Number(condition.params?.value??condition.value);
      if(id==='ally_targeted_by_foe')return states.some(s=>s.team!==self.team&&s.hp>0&&s.targetId===subject.id);
      if(id==='ally_targeted_by_ally')return states.some(s=>s.team===self.team&&s.id!==subject.id&&s.hp>0&&s.targetId===subject.id);
      if(id==='foe_targeting_self')return subject.targetId===self.id;
      if(id==='foe_targeting_leader')return subject.targetId===(self.partyLeaderId??self.id);
      if(id==='foe_party_leader_target'){const leader=states.find(s=>s.id===(self.partyLeaderId??self.id));return subject.id===leader?.targetId;}
      if(id==='foe_not_targeted_by_ally')return !states.some(s=>s.team===self.team&&s.id!==self.id&&s.targetId===subject.id);
      return GambitEvaluator.evaluateCondition(condition,id.startsWith('ally_')?snapshot(subject):snapshot(self),{...snapshot(subject),elementalRulesVersion},self.inventory);
    };
    const allyPool=states.filter(s=>s.team===self.team);
    const foePool=states.filter(s=>s.team!==self.team&&s.hp>0);
    const groupMatches=(group:any[],subject:BattleActorState)=>group.every(condition=>matches(condition,subject));
    candidates=candidates.filter(candidate=>
      groupMatches(grouped.self,self)&&
      (!grouped.ally.length||(actionScope==='ally'?groupMatches(grouped.ally,candidate):allyPool.some(subject=>groupMatches(grouped.ally,subject))))&&
      (!grouped.foe.length||(actionScope==='foe'?groupMatches(grouped.foe,candidate):foePool.some(subject=>groupMatches(grouped.foe,subject))))
    );
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
    const randomKo=actionScope==='ally'&&conditions.some((c:any)=>String(c.id)==='ally_has_status'&&String(c.params?.status??c.status).toLowerCase()==='ko');
    const target=randomKo?candidates[Math.floor(random()*candidates.length)]:candidates[0];
    return {action,line,target};
  }
  return null;
}
