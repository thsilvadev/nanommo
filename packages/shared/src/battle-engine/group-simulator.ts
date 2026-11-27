import { consumableCooldownKey } from './combat-timers';
import { elementalMultiplier, basicAttackElementMultiplier, normalizeElement } from '../elements';
import { burnStatusPayload, periodicDamageAmount, periodicDamageProfile } from './elemental-status';
import type { ActorEvent, ActorEventPayload, BattleActor, BattleActorState, BattleInputV2, BattleResultV2, CombatEffectDefinition, CombatSkillDefinition, GroupGambitAction } from '../types/group-battle';
import { BattleEngine, effectiveFoodStatValue, effectiveSkillCastTicks } from './index';
import { Mulberry32 } from './prng';
import { createActorStates } from './actors';
import { BATTLE_GRID_SIZE, findGridPathToRange, gridDistance, gridKey, nearestFreeGridPosition, validGridPosition } from './grid';
import { actionParams, selectGroupGambit, TargetedGambitChoice } from './targeting';
import { activeGambitLines } from './active-gambits';
import { actorEvent } from './events';
import { secondsToBattleTicks } from './time';

const statusId=(s:any):string=>String(s.type??s.id??'');
const hasStatus=(s:BattleActorState,id:string):boolean=>(s.statusEffects??[]).some(x=>statusId(x)===id);
const sumStatus=(s:BattleActorState,key:string):number=>(s.statusEffects??[]).reduce((n,x)=>n+Number(x[key]??0),0);
const multiplyStatus=(s:BattleActorState,key:string):number=>(s.statusEffects??[]).reduce((n,x)=>n*Math.max(1,Number(x[key]??1)),1);
function assertInput(input:BattleInputV2):void {
  if(input.version!==2||input.tickDurationMs!==500)throw new Error('V2 requires 500 ms ticks');
  const ids=new Set<string>();const positions=new Set<string>();
  for(const actor of input.actors) {
    if(!actor.id||ids.has(actor.id))throw new Error('Battle actor IDs must be unique');ids.add(actor.id);
    if(!['a','b'].includes(actor.team))throw new Error('Unknown battle team');
    if(!validGridPosition(actor.position))throw new Error('Actor outside 10x10 battle grid');
    const position=gridKey(actor.position);if(actor.snapshot.hp>0&&positions.has(position))throw new Error('Living actors require unique grid positions');if(actor.snapshot.hp>0)positions.add(position);
    for(const stat of ['hp','sp','maxHp','maxSp','atk','matk','def','mdefPercent','accuracy','evasion','critChance'])if(!Number.isFinite(Number(actor.snapshot[stat as keyof typeof actor.snapshot])))throw new Error(`Invalid actor stat ${stat}`);
  }
  for(const team of ['a','b']) {const count=input.actors.filter(a=>a.team===team).length;if(!count||count>10)throw new Error('Each team requires 1 to 10 actors');}
  if(input.maxTicks!==undefined&&(!Number.isInteger(input.maxTicks)||input.maxTicks<1||input.maxTicks>100000))throw new Error('Invalid battle tick limit');
}
/** One timeline, one immutable input. Replay uses this exact executor and stops at a completed tick. */
function execute(input:BattleInputV2,throughTick=Infinity):BattleResultV2 {
  assertInput(input);
  const elementalRules = input.elementalRulesVersion === 1;
  const cappedMovement = input.movementRulesVersion === 1;
  const actors=[...input.actors].sort((a,b)=>a.team===b.team?(a.id<b.id?-1:a.id>b.id?1:0):a.team==='a'?-1:1);
  const actorById=new Map(actors.map(a=>[a.id,a]));
  const states=createActorStates(input.actors);const units=actors.map(a=>states[a.id]);const events:ActorEvent[]=[];
  const definitions=input.definitions??{};
  for(const state of units){state.skillDefs={...definitions.skills,...state.skillDefs};if(state.kind==='monster'&&!state.skills)state.skills={...definitions.skills};state.moveSpeedBase=Number(state.moveSpeedBase??state.moveSpeed??50);}
  const maxTicks=input.maxTicks??100000;
  let tick=0;let durationTicks=0;let termination:BattleResultV2['termination']='stalemate';let ended=false;
  const stream=(self:BattleActorState,domain:string)=>new Mulberry32(`${input.seed}:${self.id}:${tick}:${domain}`);
  const record=(self:BattleActorState,targets:BattleActorState[],action:string,payload:ActorEventPayload)=>events.push({...actorEvent(tick,self,targets,action,payload),actorStates:Object.fromEntries(units.map(s=>[s.id,{hp:s.hp,sp:s.sp,position:{...s.position},statusEffects:JSON.parse(JSON.stringify(s.statusEffects??[])),...(s.targetId?{targetId:s.targetId}:{})}]))});
  const living=(team:string)=>units.filter(s=>s.team===team&&s.hp>0);
  const blocked=(self:BattleActorState)=>units.filter(s=>s.hp>0&&s.id!==self.id).map(s=>s.position);
  const setTarget=(self:BattleActorState,target:BattleActorState)=>{if(self.targetId!==target.id){const previousTargetId=self.targetId;self.targetId=target.id;record(self,[target],'target',{type:'target',...(previousTargetId?{previousTargetId}:{})});}};
  const applyStatus=(source:BattleActorState,target:BattleActorState,id:string,duration?:number,extra:Record<string,number|string>={})=>{
    const def=definitions.statuses?.[id]??{};
    if(elementalRules&&id==='burn'){extra={...extra,...burnStatusPayload(source.matk+sumStatus(source,'matkBonus'),def,tick)};duration=Number(def.statusDurationTicks??50);}
    const existing=(target.statusEffects??[]).filter(s=>statusId(s)===id);
    if(!def.stackable&&existing.length&&def.reapplication!=='refresh')return;
    if(!def.stackable)target.statusEffects=(target.statusEffects??[]).filter(s=>statusId(s)!==id);
    else if(existing.length>=Math.max(1,Number(def.maxStacks??1)))return;
    const interval=Number(extra.damageIntervalTicks??def.damageIntervalTicks??10);
    target.statusEffects!.push({type:id,appliedAtTick:tick,...((duration??Number(def.statusDurationTicks??0))>0?{expiresAtTick:tick+Number(duration??def.statusDurationTicks)}:{}),sourceActorId:source.id,...(elementalRules?{sourceActor:source.kind==='monster'?'monster':'character'}:{}),sourceSkillId:String(extra.sourceSkillId??''),...(def.moveSpeedPenalty!==undefined?{moveSpeedPenalty:def.moveSpeedPenalty}:{}),...(def.attackSpeedPenalty!==undefined?{attackSpeedPenalty:def.attackSpeedPenalty}:{}),...(def.damagePerStack!==undefined?{damagePerTick:def.damagePerStack,damageIntervalTicks:interval,nextDamageAtTick:tick+interval}:{}),...extra});
    record(source,[target],'status_apply',{type:'status',statusId:id,...(elementalRules?{sourceSkillId:String(extra.sourceSkillId??''),...(extra.sourceSkillId==='monster_skill_flaming_pound'?{passiveProc:true}:{})}:{})});
    if(id==='disarm'&&actorById.get(target.id)?.definitionId==='mon_brokensentinel')applyStatus(target,target,'physical_reflection',30,{reflectPercent:30,sourceSkillId:'monster_skill_physical_reflection'});
  };
  const revive=(self:BattleActorState,target:BattleActorState,hpPercent:number,spPercent:number,cleanse:boolean)=>{
    const position=nearestFreeGridPosition(target.position,blocked(target));
    if(gridKey(position)!==gridKey(target.position)){const from={...target.position};target.position=position;record(self,[target],'move',{type:'move',from,to:{...position},reason:'revive'});}
    target.hp=Math.max(1,Math.floor(target.maxHp*hpPercent/100));target.sp=Math.floor(target.maxSp*spPercent/100);if(cleanse)target.statusEffects=[];
    target.pendingCast=null;target.attackGauge=0;target.castGauge=0;
    record(self,[target],'revive',{type:'lifecycle',reason:'revive'});
  };
  const death=(self:BattleActorState)=>{
    if(self.hp>0)return;
    self.pendingCast=null;self.movementIntent=false;
    record(self,[self],'ko',{type:'lifecycle',reason:'damage'});
    const choice=selectGroupGambit(actorById.get(self.id)!,self,units,'cast',definitions,()=>stream(self,'death-target').next(),elementalRules?1:0);
    const deathCondition=choice?.line.conditions?.some((condition:any)=>condition.id==='upon_death'||(condition.id==='self_has_status'&&String(condition.params?.status??condition.status??'').toLowerCase()==='ko'));
    if(deathCondition&&choice?.action.id==='use_item'&&definitions.items?.[String(actionParams(choice.action).itemId)]?.effect?.type==='revive_full_cleanse')resolveItem(self,choice.action,self);
  };
  const absorbMagic=(target:BattleActorState,value:number):number=>{
    for(const status of [...target.statusEffects??[]]) if(statusId(status)==='magic_barrier') {const absorbed=Math.min(value,Math.max(0,Number(status.absorbRemaining??0)));value-=absorbed;status.absorbRemaining=Number(status.absorbRemaining??0)-absorbed;if(status.absorbRemaining<=0){target.statusEffects=(target.statusEffects??[]).filter(current=>current!==status);record(target,[target],'status_expire',{type:'status',statusId:'magic_barrier'});}}
    return value;
  };
  const damage=(source:BattleActorState,target:BattleActorState,raw:number,damageType:string,domain:string,variance=true,element:unknown='neutral',elementScale?:number):number=>{
    let final=damageType==='pure'?raw:damageType==='magical'||damageType==='magic'?BattleEngine.calculateMagicDamage(raw,Math.min(100,target.mdefPercent+sumStatus(target,'mdefPercentBonus'))):BattleEngine.calculatePhysicalDamage(raw,target.def+sumStatus(target,'defBonus'));
    const actor=actorById.get(target.id)!;const archetype=damageType==='magical'||damageType==='magic'?'magic':source.basicAttackDamageType==='ranged'?'ranged':'melee';
    final*=Number(actor.damageTakenMultiplier?.[archetype]??1);
    const weapon=(source.equippedWeaponTypes??[]).find(type=>!['shield','rune'].includes(type));if(weapon)final*=Number(actor.weaponCategoryDamageTakenMultiplier?.[weapon]??1);
    if(elementalRules&&damageType!=='pure')final*=elementScale??elementalMultiplier(element,target.element);
    if(variance)final=BattleEngine.applyDirectDamageVariance(final,stream(source,domain));
    let value=Math.max(0,Math.floor(final));
    if(['magical','magic'].includes(damageType))value=absorbMagic(target,value);
    target.hp=Math.max(0,target.hp-value);return value;
  };
  function resolveItem(self:BattleActorState,action:GroupGambitAction,target:BattleActorState):void {
    const itemId=String(actionParams(action).itemId);const def=definitions.items?.[itemId];if(!def||(self.inventory[itemId]??0)<=0)return;
    const e=def.effect??{type:''};const type=String(e.type??'');
    if(['revive_ally','revive_half','revive_full_cleanse'].includes(type)&&target.hp>0)return;
    self.inventory[itemId]--;const consumed=self.itemsConsumed.find(x=>x.itemId===itemId);if(consumed)consumed.quantity++;else self.itemsConsumed.push({itemId,quantity:1});
    const cooldowns=self.cooldowns!;
    if(def.alchemyCategory==='super_tonics'||['revive_full_cleanse','revive_ally','revive_half'].includes(type))cooldowns['item:super_tonic']=secondsToBattleTicks(def.cooldownInSeconds??def.cooldownSeconds??60);
    else if(def.alchemyCategory==='potions'||['heal_hp','heal_sp','heal_hp_sp','heal_status','cure_status'].includes(type))cooldowns['item:potion']=secondsToBattleTicks(def.cooldownInSeconds??def.cooldownSeconds??10);
    else if(def.alchemyCategory==='tonics'||type==='apply_status')cooldowns['item:tonic']=secondsToBattleTicks(def.cooldownInSeconds??def.cooldownSeconds??30);
    else cooldowns[`item:${itemId}`]=secondsToBattleTicks(def.cooldownInSeconds??def.cooldownSeconds??0);
    const hpBefore=target.hp,spBefore=target.sp;
    if(type==='heal_hp')target.hp=Math.min(target.maxHp,target.hp+Number(e.amount??0));
    if(type==='heal_sp')target.sp=Math.min(target.maxSp,target.sp+Number(e.amount??0));
    if(type==='heal_hp_sp'){target.hp=Math.min(target.maxHp,target.hp+Number(e.hpAmount??0));target.sp=Math.min(target.maxSp,target.sp+Number(e.spAmount??0));}
    if(type==='revive_full_cleanse')revive(self,target,100,100,true);
    if(type==='revive_ally'||type==='revive_half')revive(self,target,Number(e.hpPercent??50),Number(e.spPercent??50),false);
    if(type==='cure_status'||type==='heal_status')target.statusEffects=(target.statusEffects??[]).filter(s=>statusId(s)!==e.status);
    if(type==='apply_status'&&e.status)applyStatus(self,target,e.status,e.durationSeconds!==undefined?secondsToBattleTicks(e.durationSeconds):undefined,{...Object.fromEntries(['defBonus','mdefPercentBonus','attackSpeedMultiplier','castTimeReductionMultiplier'].filter(k=>e[k]!==undefined).map(k=>[k,Number(e[k])]))});
    if(type==='food_buff') {
      const ticks=secondsToBattleTicks(Number(e.durationSeconds??0));const old=self.dietLevelByFood??{};const level=Object.prototype.hasOwnProperty.call(old,itemId)?Math.min(3,Number(old[itemId])+1):0;self.dietLevelByFood={...old,[itemId]:level};
      const buff={itemId,hpRegenPerTenTicks:effectiveFoodStatValue(Number(e.hpRegenPerTenTicks??0),level),spRegenPerTenTicks:effectiveFoodStatValue(Number(e.spRegenPerTenTicks??0),level),remainingTicks:ticks};self.foodBuffs=[...(self.foodBuffs??[]).filter(b=>b.itemId!==itemId),buff];self.foodDigestRemainingTicksByItem![itemId]=ticks;
      self.foodBuffItemId=itemId;self.foodBuffTicksRemaining=ticks;self.foodBuffHpRegenPerTenTicks=buff.hpRegenPerTenTicks;self.foodBuffSpRegenPerTenTicks=buff.spRegenPerTenTicks;
    }
    self.castLockTicks=2;
    record(self,[target],'use_item',{type:'action',itemId,...(Number(cooldowns[consumableCooldownKey(def,itemId)])>0?{cooldown:{key:consumableCooldownKey(def,itemId),durationTicks:cooldowns[consumableCooldownKey(def,itemId)]}}:{}),healAmount:target.hp-hpBefore,spGain:target.sp-spBefore});
  }
  const applySkillStatus=(self:BattleActorState,target:BattleActorState,skillId:string,e:CombatEffectDefinition,rank:number)=>{
    if(e.applyStatus&&target.hp>0) {
      const luckSave=e.saveButtLuck===true?Math.min(10,Math.max(0,Number(target.luk??0)))/100:0;
      if(stream(self,`status:${skillId}:${target.id}`).chance(Math.max(0,Number(e.statusChance??1)-luckSave))) {
        const duration=e.statusDurationTicksByRank?.[Math.min(rank,e.statusDurationTicksByRank.length)-1]??e.statusDurationTicks;
        applyStatus(self,target,e.applyStatus,duration??(e.applyStatus==='poison'?Number(e.durationTicks??50):e.applyStatus==='bleed'?Number(e.durationTicks??40):undefined),{sourceSkillId:skillId,...(e.applyStatus==='poison'?{damagePerTick:Math.floor(self.matk*0.5),damageIntervalTicks:Number(e.damageIntervalTicks??10),nextDamageAtTick:tick+Number(e.damageIntervalTicks??10),damageType:'magic'}:{})});
      }
    }
    if(Number(e.burnChance??0)>0&&target.hp>0&&stream(self,`burn:${skillId}:${target.id}`).chance(Number(e.burnChance)))applyStatus(self,target,'burn',elementalRules?undefined:Number(e.burnDurationTicks??50),{sourceSkillId:skillId,...(elementalRules?{}:{damagePerTick:Math.floor(self.matk/5),damageIntervalTicks:Number(e.burnIntervalTicks??10),nextDamageAtTick:tick+Number(e.burnIntervalTicks??10)})});
  };
  const resolveSkill=(self:BattleActorState,action:GroupGambitAction,target:BattleActorState)=>{
    const skillId=String(actionParams(action).skillId);const def:CombatSkillDefinition=self.skillDefs?.[skillId]??definitions.skills?.[skillId]??{};const e=def.effect??{type:''};const rank=Math.max(1,Number(def.masteryRank??1));
    const baseCost=Number(def.spCost??0);const dynamoRank=Number(self.skillDefs?.arcane_dynamo?.masteryRank??0);const spCost=Math.max(0,baseCost);if(self.sp<spCost)return;
    const spBefore=self.sp;self.sp-=spCost;self.cooldowns![`skill:${skillId}`]=Math.max(0,Number(def.cooldownTicks??0))+(Number(def.cooldownTicks??0)>0?1:0);
    const hpBefore=target.hp;let dealt=0;let holyBurn=false;const type=String(e.type??'');
    // Area skills (effect.areaRadius): the same raw damage reaches every other living foe around the caster.
    let splashRaw:number|null=null;let splashType='physical';
    if(type==='rage'){target.statusEffects=(target.statusEffects??[]).filter(s=>(definitions.statuses?.[statusId(s)] as {polarity?:string}|undefined)?.polarity!=='debuff');applyStatus(self,target,'rage',Number(e.durationTicks??30),{sourceSkillId:skillId,atkBonus:Number(e.atk??20)});}
    else if(type==='self_status_buff'&&e.applyStatus)applyStatus(self,target,e.applyStatus,Number(e.durationTicks??19998),{sourceSkillId:skillId});
    else if(type==='pickpocket'){
      const rng=stream(self,`pickpocket:${target.id}`);const luck=e.saveButtLuck===true?Math.min(10,Math.max(0,Number(target.luk??0)))/100:0;
      const eligible=Object.keys(target.inventory).filter(id=>target.inventory[id]>0&&definitions.items?.[id]?.effect?.type!=='food_buff'&&definitions.items?.[id]?.type!=='food').sort();
      if(eligible.length&&rng.chance(Math.max(0,Number(e.chance??0.1)-luck))){const itemId=rng.pick(eligible);const quantity=Math.min(target.inventory[itemId],Math.max(1,Number(definitions.items?.[itemId]?.maxStack??target.inventory[itemId])));target.inventory[itemId]-=quantity;const old=target.itemsConsumed.find(i=>i.itemId===itemId);if(old)old.quantity+=quantity;else target.itemsConsumed.push({itemId,quantity});record(self,[target],'item_stolen',{type:'action',skillId,itemId});}
    }
    else if(type==='defense_buff')applyStatus(self,target,'war_cry_def',Number(e.durationTicks??20),{sourceSkillId:skillId,defBonus:Number(e.defBonusPerRank??10)*rank});
    else if(type==='magic_barrier')applyStatus(self,target,'magic_barrier',Number(e.durationTicks??600),{sourceSkillId:skillId,absorbRemaining:Number(e.absorbPerRank??100)*rank});
    else if(Number(e.healPercentMaxHp??0)>0||Number(e.healAmount??0)>0)target.hp=Math.min(target.maxHp,target.hp+Number(e.healAmount??Math.floor(target.maxHp*Number(e.healPercentMaxHp))));
    else if(type==='self_heal'||type==='heal'){
      const amount=Number(e.healFlat??Number(e.flatPerRank??50)*rank)+Math.floor(target.maxHp*Math.floor(self.matk/Number(e.matkScaleDenominator??20))/100);
      // Holy light burns Shadow: the same amount as damage (no mitigation, variance or element scaling).
      holyBurn=normalizeElement(def.element)==='holy'&&normalizeElement(target.element)==='shadow';
      if(holyBurn)dealt=damage(self,target,amount,'pure',`skill:${skillId}:${target.id}`,false);
      else target.hp=Math.min(target.maxHp,target.hp+amount);
    }
    else if(type==='apply_status'&&e.status)applyStatus(self,target,e.status,e.durationTicks,{sourceSkillId:skillId});
    else if(type!=='arcane_dynamo_passive') {
      if(type==='blinkstrike') {const path=findGridPathToRange(self.position,target.position,blocked(self),1);if(path?.length){const from={...self.position};self.position={...path[path.length-1]};record(self,[target],'move',{type:'move',from,to:{...self.position},reason:'blinkstrike'});}}
      let raw=self.atk;
      if(type==='physical_damage')raw=e.multiplierPerRank===true?self.atk*rank:self.atk*Number(e.atkMultiplier??1)+Number(e.flatPerRank??0)*rank;
      if(type==='physical_push')raw=Number(e.damagePerRank??50)*rank;
      if(type==='magic_damage')raw=self.matk+Number(e.flatPerRank??0)*rank;
      if(type==='magic_damage_remaining_sp')raw=self.matk+self.sp;
      if(type==='magic_damage_light_wisp')raw=self.matk+25*rank+Math.floor(spBefore/5);
      // Monster definitions may use damageMultiplier/flatDamage rather than player effect families.
      if(e.dmgMult!==undefined)raw=((def.damageType==='magical'?self.matk:self.atk)+sumStatus(self,def.damageType==='magical'?'matkBonus':'atkBonus'))*Number(e.dmgMult);
      if(e.damageMultiplier!==undefined)raw=(def.damageType==='magical'?self.matk:self.atk)*Number(e.damageMultiplier)+Number(e.flatDamage??0);
      const magic=def.damageType==='magical'||def.damageType==='magic'||type.startsWith('magic_');const damageType=def.damageType??(magic?'magical':'physical');
      splashRaw=raw;splashType=damageType;
      if(!elementalRules&&def.element)raw*=Number(target.elementalDamageTakenMultiplier?.[def.element]??(target.elementalResistances?.includes(def.element)?0.5:1));
      dealt=damage(self,target,raw,damageType,`skill:${skillId}:${target.id}`,true,def.element);
      applySkillStatus(self,target,skillId,e,rank);
      // Push along the target's row to the furthest reachable column, never through another unit.
      if(type==='physical_push'&&target.hp>0) {
        const from={...target.position};
        // New row-end pushes break equal-column ties towards the nearest horizontal edge.
        const direction=target.position.column===self.position.column&&e.sameColumnPushToNearestEdge===true
          ? (target.position.column<BATTLE_GRID_SIZE/2?-1:1)
          : target.position.column>=self.position.column?1:-1;
        const occupied=new Set(blocked(target).map(gridKey));
        while(e.pushToRowEnd===true||gridDistance(self.position,target.position)-1<Number(e.targetDistance??6)) {const next={row:target.position.row,column:target.position.column+direction};if(!validGridPosition(next)||occupied.has(gridKey(next)))break;target.position=next;}
        if(gridKey(from)!==gridKey(target.position)){record(self,[target],'move',{type:'move',from,to:{...target.position},reason:'push'});if(e.targetDebuffOnSuccessfulPush)applyStatus(self,target,String(e.targetDebuffOnSuccessfulPush),Number(e.targetDebuffDurationTicks??12),{sourceSkillId:skillId,moveSpeedMultiplier:Number(e.targetMoveSpeedMultiplier??0.2)});}
      }
    }
    record(self,[target],'use_skill',{type:'action',skillId,...(Number(self.cooldowns![`skill:${skillId}`])>0?{cooldown:{key:`skill:${skillId}`,durationTicks:self.cooldowns![`skill:${skillId}`]}}:{}),damage:dealt,damageType:holyBurn?'pure':def.damageType??(type.startsWith('magic_')?'magical':'physical'),hit:true,crit:false,spSpent:spCost,healAmount:Math.max(0,target.hp-hpBefore)});
    if(target.team!==self.team&&target.hp>0){const species=actorById.get(target.id)?.definitionId;if(species==='mon_unicorn')applyStatus(target,target,'magic_prowess',40,{matkBonus:20,sourceSkillId:'monster_skill_channel'});if(species==='mon_ruinsguardian')applyStatus(target,target,'prowess',40,{atkBonus:10,defBonus:10,sourceSkillId:'monster_skill_prowess'});}
    if(dynamoRank>0){const before=self.sp;self.sp=Math.min(self.maxSp,self.sp+2*dynamoRank);if(self.sp>before)record(self,[self],'sp_refund',{type:'action',spGain:self.sp-before});}
    if(target.hp<=0)death(target);if(target.team!==self.team&&!holyBurn)reflect(self,target,dealt,def.damageType??(type.startsWith('magic_')?'magical':'physical'));
    const radius=Number(e.areaRadius??0);
    if(radius>0&&splashRaw!==null&&target.team!==self.team)for(const foe of units.filter(u=>u.team!==self.team&&u.hp>0&&u.id!==target.id&&gridDistance(self.position,u.position)<=radius)){
      if(self.hp<=0)break;
      // Full damage, its own roll; no status (Disarm stays on the target). Not a use_skill: no cooldown, SP or mastery count.
      const hit=damage(self,foe,splashRaw,splashType,`skill:${skillId}:${foe.id}`,true,def.element);
      record(self,[foe],'splash',{type:'action',skillId,damage:hit,damageType:splashType,hit:true});
      if(foe.hp<=0)death(foe);reflect(self,foe,hit,splashType);
    }
  };
  const reflect=(source:BattleActorState,target:BattleActorState,dealt:number,damageType:string)=>{
    const type=['magic','magical'].includes(damageType)?'magic_reflection':'physical_reflection';const status=(target.statusEffects??[]).find(s=>statusId(s)===type);
    if(!status||dealt<=0||source.hp<=0)return;
    const raw=dealt*Number(status.reflectPercent??30)/100;
    const reflected=Math.floor(type==='magic_reflection'?BattleEngine.calculateMagicDamage(raw,Math.min(100,source.mdefPercent+sumStatus(source,'mdefPercentBonus'))):BattleEngine.calculatePhysicalDamage(raw,source.def+sumStatus(source,'defBonus')));
    source.hp=Math.max(0,source.hp-reflected);record(target,[source],'reflect',{type:'action',damage:reflected,damageType,hit:true});if(source.hp<=0)death(source);
  };
  const resolveAttack=(self:BattleActorState,target:BattleActorState)=>{
    const rng=stream(self,`attack:${target.id}`);const focus=self.skillDefs?.fearless_focus;const focusRank=Number(focus?.masteryRank??0);const distance=Math.max(0,gridDistance(self.position,target.position)-1);
    const accuracy=self.accuracy+focusRank*Number(focus?.effect?.accuracyPerRank??5)+(focusRank>0?distance*Number(focus?.effect?.accuracyPerSpace??5):0);
    const focusAtk=focusRank*Number(focus?.effect?.atkPerRank??5)+(focusRank>0?distance*Number(focus?.effect?.atkPerSpace??5):0);
    const hit=rng.chance(BattleEngine.calculateHitChance(accuracy,target.evasion)/100);const crit=hit&&rng.chance(self.critChance/100);let dealt=0;
    const magic=self.basicAttackDamageType==='magic';const damageType=magic?'magical':'physical';
    const tip=!magic&&hasStatus(self,'tip_of_pain');
    const daggerHands=(self.masteryEquipment??[]).filter(hand=>hand.category==='dagger').length;const doubleRank=Number(self.skillDefs?.double_strike?.masteryRank??0);
    const count=hit&&daggerHands>0&&rng.chance(Math.min(1,daggerHands*doubleRank*0.05))?2:1;const damageComponents:number[]=[];
    if(hit) {
      const effectiveAtk=(magic?self.matk:self.atk)+sumStatus(self,magic?'matkBonus':'atkBonus')+focusAtk;
      for(let component=0;component<count;component++)damageComponents.push(damage(self,target,effectiveAtk*(crit?BattleEngine.CRIT_MULTIPLIER:1)*(tip?2:1),damageType,`attack-variance:${target.id}:${component}`,true,'neutral',basicAttackElementMultiplier({...self,atk:effectiveAtk},target)));
      dealt=damageComponents.reduce((a,b)=>a+b,0);
      const swordRank=Number(self.skillDefs?.swordsmanship?.masteryRank??0);const bleed=definitions.statuses?.bleed;
      if(swordRank>0&&bleed&&stream(self,`swordsmanship:${target.id}`).chance(Number(bleed.procChancePerRank??0.01)*swordRank))applyStatus(self,target,'bleed',undefined,{sourceSkillId:'swordsmanship',damagePerTick:Number(bleed.damagePerStack??5)*swordRank,damageIntervalTicks:Number(bleed.damageIntervalTicks??10),nextDamageAtTick:tick+Number(bleed.damageIntervalTicks??10),damageType:'pure'});
      const dynamoRank=Number(self.skillDefs?.arcane_dynamo?.masteryRank??0);if(dynamoRank>0)self.sp=Math.min(self.maxSp,self.sp+2*dynamoRank);
      const shieldRank=Number(target.skillDefs?.shield_bash?.masteryRank??0);if(shieldRank>0&&distance===0&&rng.chance(Math.min(1,0.02*shieldRank)))applyStatus(target,self,'stun',10,{sourceSkillId:'shield_bash'});
      if(elementalRules&&target.hp>0&&self.passiveSkills?.includes('monster_skill_flaming_pound')) {
        const effect=self.skillDefs?.monster_skill_flaming_pound?.effects?.[0]??{};
        if(stream(self,`flaming-pound:${target.id}`).chance(Math.max(0,Math.min(1,Number(effect.statusChance??0.2)))))applyStatus(self,target,'burn',undefined,{sourceSkillId:'monster_skill_flaming_pound'});
      }
      if(actorById.get(self.id)?.definitionId==='mon_giantspider') {const prey=self.skillDefs?.monster_skill_silk_prey?.effects?.[0]??{};if(rng.chance(Number(prey.chance??0.1)))applyStatus(self,target,'web_pack',Number(prey.durationTicks??20),{sourceSkillId:'monster_skill_silk_prey'});}
    }
    if(tip){self.statusEffects=(self.statusEffects??[]).filter(s=>statusId(s)!=='tip_of_pain');if(hit&&target.hp>0)applyStatus(self,target,'disarm',20,{sourceSkillId:'monster_skill_sting'});}
    record(self,[target],'attack',{type:'action',damage:dealt,damageType,hit,crit,...(count>1?{damageComponents}:{})});
    if(target.hp<=0)death(target);reflect(self,target,dealt,damageType);
    if(self.kind!=='monster'){self.attackLockTicks=BattleEngine.BASIC_ATTACK_LOCK_TICKS;self.attackPreparationStartsAtTick=tick+BattleEngine.BASIC_ATTACK_LOCK_TICKS+1;}
  };
  const approach=(self:BattleActorState,target:BattleActorState,range:number)=>{
    self.movementIntent=true;self.movementIntentRange=range;
    if(self.canMove===false||hasStatus(self,'stun'))return;
    let penalty=0;for(const s of self.statusEffects??[]){const def=definitions.statuses?.[statusId(s)]??{};penalty+=Number(def.moveSpeedPenaltyPerStack??def.moveSpeedPenalty??s.moveSpeedPenalty??0);}
    const multiplier=(self.statusEffects??[]).reduce((n,status)=>n*Math.max(0,Number(status.moveSpeedMultiplier??definitions.statuses?.[statusId(status)]?.moveSpeedMultiplier??1)),1);
    self.moveSpeed=Math.max(0,(Number(self.moveSpeedBase??self.moveSpeed??50)-penalty)*multiplier);
    if(self.movementGauge<200)return;
    const path=findGridPathToRange(self.position,target.position,blocked(self),range+1);if(!path?.length){self.movementGauge=Math.min(self.movementGauge,200);return;}
    const from={...self.position};self.position={...path[0]};self.movementGauge-=200;
    record(self,[target],'move',{type:'move',from,to:{...self.position},reason:'approach'});
  };
  const inRange=(self:BattleActorState,target:BattleActorState,range:number)=>self.id===target.id||gridDistance(self.position,target.position)-1<=range;
  const choose=(actor:BattleActor,self:BattleActorState,gauge:'attack'|'cast')=>selectGroupGambit(actor,self,units,gauge,definitions,()=>stream(self,`target:${gauge}`).next(),elementalRules?1:0);
  const anyActions=actors.some(a=>activeGambitLines(a.gambits).length>0);
  // Prove this narrow stalemate without applying a general duration limit: no
  // actor can move, no active line can do anything except attack, no status
  // can change that, and every opposing pair starts outside attack range.
  const immobileMeleeOnly = units.every(unit => unit.hp>0) && actors.every(actor => {
    const unit=states[actor.id];
    const immobile=unit.canMove===false || Number(unit.moveSpeedBase??unit.moveSpeed??50)<=0;
    const attacksOnly=activeGambitLines(actor.gambits).every(line => {
      const action=line.action as GroupGambitAction;
      return (action.id??action.type)==='attack';
    });
    return immobile && attacksOnly && (unit.statusEffects??[]).length===0;
  }) && units.every(unit => units.filter(target=>target.team!==unit.team).every(target => {
    const range=Number(unit.basicAttackRange??(unit.basicAttackDamageType==='ranged'?6:0));
    return gridDistance(unit.position,target.position)-1>range;
  }));
  if(immobileMeleeOnly)return {version:2,outcome:'loss',events,actorsAfter:states,durationTicks:0,ended:true,termination:'stalemate'};
  if(!anyActions&&units.every(s=>!(s.statusEffects??[]).some(x=>Number(x.damagePerTick??0)>0)))return {version:2,outcome:'loss',events,actorsAfter:states,durationTicks:0,ended:true,termination:'stalemate'};
  for(tick=0;tick<maxTicks&&tick<=throughTick;tick++) {
    // A dead team still gets its immediate Fairy opportunity from the death handler.
    if(!living('a').length||!living('b').length){ended=true;termination=living('a').length?'victory':'defeat';break;}
    for(const self of units) {
      for(const key of Object.keys(self.cooldowns!))self.cooldowns![key]=Math.max(0,self.cooldowns![key]-1);if(tick>0){self.attackLockTicks=Math.max(0,Number(self.attackLockTicks??0)-1);self.castLockTicks=Math.max(0,Number(self.castLockTicks??0)-1);}
      const expired=(self.statusEffects??[]).filter(s=>Number(s.expiresAtTick??Infinity)<=tick);self.statusEffects=(self.statusEffects??[]).filter(s=>Number(s.expiresAtTick??Infinity)>tick);for(const status of expired)record(self,[self],'status_expire',{type:'status',statusId:statusId(status)});
      if(self.hp>0)for(const s of self.statusEffects??[]) {
        const def=definitions.statuses?.[statusId(s)]??{};const interval=Number(s.damageIntervalTicks??def.damageIntervalTicks??10);const next=Number(s.nextDamageAtTick??Number(s.appliedAtTick??0)+interval);
        if(Number(s.damagePerTick??def.damagePerStack??0)>0&&tick>=next){
          const raw=Math.max(0,Number(s.damagePerTick??def.damagePerStack??0));
          const profile=periodicDamageProfile(s,def);
          let dealt=elementalRules?periodicDamageAmount(raw,s,def,self,self.mdefPercent+sumStatus(self,'mdefPercentBonus')):s.damageType==='magic'?Math.floor(BattleEngine.calculateMagicDamage(raw,Math.min(100,self.mdefPercent+sumStatus(self,'mdefPercentBonus')))):raw;
          if(elementalRules&&statusId(s)==='burn'&&['magic','magical'].includes(profile.damageType))dealt=absorbMagic(self,dealt);
          self.hp=Math.max(0,self.hp-dealt);s.nextDamageAtTick=tick+Math.max(1,interval);
          const sourceId=String(s.sourceActorId??'');
          const sourceActor=s.sourceActor??(sourceId.startsWith('monster:')?'monster':sourceId? 'character':self.kind==='monster'?'character':'monster');
          const source=states[sourceId]??(elementalRules?{id:sourceId||`carried:${sourceActor}`} as BattleActorState:self);
          record(source,[self],'status_tick',{type:'status',statusId:statusId(s),damage:dealt,...(elementalRules?{sourceSkillId:String(s.sourceSkillId??''),sourceActor,damageType:profile.damageType,element:String(profile.element)}:{})});if(self.hp<=0){death(self);break;}
        }
      }
      if(self.hp<=0)continue;
    }
    for(const actor of actors) {
      const self=states[actor.id];if(self.hp<=0||hasStatus(self,'stun'))continue;
      self.movementIntent=false;
      // Standing still (in range, casting) earns at most the next step: no banked dash afterwards (it also voided slows).
      if(tick>0)self.movementGauge=(cappedMovement?Math.min(Number(self.movementGauge),200):Number(self.movementGauge))+Number(self.moveSpeed??self.moveSpeedBase??50);
      if(self.pendingCast) {
        const pending=self.pendingCast;
        if(pending.resolvesAtTick<=tick){self.pendingCast=null;const original=states[pending.targetId];const skill=self.skillDefs?.[String(actionParams(pending.action).skillId)]??definitions.skills?.[String(actionParams(pending.action).skillId)];
          // Target identity is frozen at cast start; dead targets cause a deterministic fizzle.
          if(original&&original.hp>0&&(skill?.target!=='foe'||original.team!==self.team))resolveSkill(self,pending.action,original);
          else record(self,original?[original]:[],'cast_fizzle',{type:'action',skillId:String(actionParams(pending.action).skillId)});
          if(self.kind==='monster'&&self.hp>0){const next=choose(actor,self,'cast');const nextSkillId=String(next? actionParams(next.action).skillId:'');const nextDef:CombatSkillDefinition=self.skillDefs?.[nextSkillId]??{};const duration=Math.max(0,Number(nextDef.baseCastTicks??BattleEngine.DEFAULT_MONSTER_CAST_TICKS));const range=Math.max(0,Number(nextDef.maxRange??(nextDef.ranged?7:1))-1);if(next?.action.id==='use_skill'&&nextSkillId===String(actionParams(pending.action).skillId)&&Number(nextDef.cooldownTicks??0)===0&&duration>0&&inRange(self,next.target,range)){self.pendingCast={action:JSON.parse(JSON.stringify(next.action)),targetId:next.target.id,resolvesAtTick:tick+duration,startedAtTick:tick};record(self,[next.target],'cast_start',{type:'cast',skillId:nextSkillId,resolvesAtTick:tick+duration});}}
        }
        self.attackGauge=0;continue;
      }
      const cast=choose(actor,self,'cast');
      if(!cast||cast.action.id!=='use_skill'){const attackIntent=choose(actor,self,'attack');if(attackIntent)setTarget(self,attackIntent.target);}
      if(actor.definitionId==='mon_arcanewisp'&&self.sp<Number(self.skillDefs?.monster_skill_arcane_surge?.spCost??60)&&!hasStatus(self,'silence')&&!hasStatus(self,'magic_reflection'))applyStatus(self,self,'magic_reflection',30,{reflectPercent:30,sourceSkillId:'monster_skill_magic_reflection'});
      if(cast?.action.id==='use_skill'&&Number(self.castLockTicks??0)<=0) {
        const skillId=String(actionParams(cast.action).skillId);const def:CombatSkillDefinition=self.skillDefs?.[skillId]??definitions.skills?.[skillId]??{};const range=Math.max(0,Number(def.maxRange??(def.ranged?7:1))-1);
        setTarget(self,cast.target);
        if(!inRange(self,cast.target,range)&&def.effect?.type!=='blinkstrike')approach(self,cast.target,range);
        else {const ticks=actor.kind==='monster'?Math.max(0,Number(def.baseCastTicks??BattleEngine.DEFAULT_MONSTER_CAST_TICKS)):effectiveSkillCastTicks(def.baseCastTicks,Number(self.castTimeReduction??self.dex*2)*multiplyStatus(self,'castTimeReductionMultiplier'));self.attackGauge=0;self.castGauge=0;
          if(ticks===0)resolveSkill(self,cast.action,cast.target);else {self.pendingCast={action:JSON.parse(JSON.stringify(cast.action)),targetId:cast.target.id,resolvesAtTick:tick+ticks,startedAtTick:tick};record(self,[cast.target],'cast_start',{type:'cast',skillId,resolvesAtTick:tick+ticks});}continue;}
      }
      if(Number(self.attackLockTicks??0)<=0) {
        let penalty=0;for(const s of self.statusEffects??[]){const def=definitions.statuses?.[statusId(s)]??{};penalty+=Number(def.attackSpeedPenaltyPerStack??def.attackSpeedPenalty??s.attackSpeedPenalty??0);}
        const preparation=actor.kind==='monster'?Math.max(0,(Number(actor.attackIntervalTicks??12)+penalty*18/800)/(hasStatus(self,'rage')?2:1)):BattleEngine.attackDurationTicks(Number(self.attackSpeed??100+self.agi*2)-penalty)/multiplyStatus(self,'attackSpeedMultiplier');
        self.attackGauge=preparation<=0?1:tick>=Number(self.attackPreparationStartsAtTick??0)?self.attackGauge+1/preparation:self.attackGauge;
        if(self.attackGauge>=1-1e-12){self.attackGauge=0;const attack=choose(actor,self,'attack');if(attack){setTarget(self,attack.target);const range=Number(self.basicAttackRange??(self.basicAttackDamageType==='ranged'?6:0));if(!inRange(self,attack.target,range)){if(!self.movementIntent)approach(self,attack.target,range);}else resolveAttack(self,attack.target);}}
        // Keep approaching between gauge fires only while a legal attack asks for it.
        // A retained spell target alone must not pull a caster into melee on cooldown.
        else if(!self.movementIntent){const attack=choose(actor,self,'attack');if(attack){setTarget(self,attack.target);const range=Number(self.basicAttackRange??(self.basicAttackDamageType==='ranged'?6:0));if(!inRange(self,attack.target,range))approach(self,attack.target,range);}}
      }
      if(self.hp>0&&Number(self.castLockTicks??0)<=0){self.castGauge++;if(self.castGauge>=BattleEngine.castGaugeThreshold(self.dex)){self.castGauge=0;const choice=choose(actor,self,'cast');if(choice?.action.id==='use_item'){setTarget(self,choice.target);resolveItem(self,choice.action,choice.target);}}}
    }
    for(const self of units) {
      if(self.hp>0&&(tick+Number(input.regenTickOffset??0))%20===19){const hp=self.hp,sp=self.sp;const food=(self.foodBuffs??[]).filter(buff=>buff.remainingTicks>1);self.hp=Math.min(self.maxHp,self.hp+self.hpRegenPerTenTicks+food.reduce((n,b)=>n+b.hpRegenPerTenTicks,0));self.sp=Math.min(self.maxSp,self.sp+self.spRegenPerTenTicks+food.reduce((n,b)=>n+b.spRegenPerTenTicks,0));if(self.hp!==hp||self.sp!==sp)record(self,[self],'regen',{type:'regen',hpGain:self.hp-hp,spGain:self.sp-sp});}
for(const key of Object.keys(self.foodDigestRemainingTicksByItem!))self.foodDigestRemainingTicksByItem![key]=Math.max(0,self.foodDigestRemainingTicksByItem![key]-1);self.foodBuffs=(self.foodBuffs??[]).map(b=>({...b,remainingTicks:b.remainingTicks-1})).filter(b=>b.remainingTicks>0);self.foodBuffTicksRemaining=Math.max(0,Number(self.foodBuffTicksRemaining??0)-1);}
    durationTicks=tick+1;
    if(!living('a').length||!living('b').length){ended=true;termination=living('a').length?'victory':'defeat';break;}
  }
  if(!ended) {if(durationTicks>=maxTicks){ended=false;termination='limit';}else termination='checkpoint';}
  return {version:2,outcome:ended&&termination==='victory'?'win':'loss',events,actorsAfter:states,durationTicks,ended,termination};
}
export function simulateBattleV2(input:BattleInputV2):BattleResultV2 {return execute(input);}
export function replayBattleV2(input:BattleInputV2,throughTick:number):BattleResultV2 {
  if(!Number.isFinite(throughTick)||throughTick<0)throw new Error('Replay tick must be finite and nonnegative');
  return execute({...input,elementalRulesVersion:input.elementalRulesVersion??0},Math.floor(throughTick));
}
