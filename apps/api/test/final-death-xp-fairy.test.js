const assert=require('node:assert/strict');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
async function settlement(hp, outcome, fled, previousRevive=true, engineResult) {
  const service=Object.create(SharedBattleService.prototype);
  const actor={id:'a',kind:'character',team:'a',inventory:{},snapshot:{level:1,maxHp:100,maxSp:100,masteryEquipment:[]}};
  const row={id:'b',state:'started',mapId:'field',seed:'seed',revision:1,startAt:new Date(0),endAt:new Date(1000),snapshot:{actors:[actor]},log:{outcome,durationTicks:2,events:previousRevive?[{payload:{type:"action",revived:true}}]:[],actorsAfter:{a:{hp,sp:0,inventory:{},statusEffects:[],cooldowns:{},foodBuffs:[]}}},result:{roster:[]}};
  if(engineResult) row.log=engineResult;
  const c={id:'a',hpCurrent:100,spCurrent:100,level:1,xp:500,dietLevels:{},knownItemIds:[]};
  const manager={getRepository:()=>({save:async x=>x,findOneBy:async()=>null}),query:async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM shared_battles'))return [row];
    if(sql.startsWith('UPDATE shared_battles SET state='))row.state=args[1];
    return [];
  }};
  Object.assign(service,{data:{getXpToNextLevel:()=>1000},inventory:{},quests:{}});
  const ctx={characters:[c],manager,now:1000};
  assert.equal(await service.resolve(ctx,row,async()=>{},fled,fled?row.log:undefined),true);
  const expected=hp<=0?480:500;
  assert.equal(c.xp,expected,`final hp=${hp}, outcome=${outcome}, flee=${fled}`);
  assert.equal(await service.resolve(ctx,row,async()=>{},fled),false);
  assert.equal(c.xp,expected,'redelivery cannot charge twice');
}
(async()=>{
  for(const args of [[100,'win',false],[100,'loss',true],[0,'loss',false],[0,'win',false],[100,'loss',false]])await settlement(...args);
  const {deathXpLoss}=require('../../../packages/shared/dist');
  assert.equal(deathXpLoss(1000,500),20);assert.equal(deathXpLoss(1000,3),3);
  assert.equal(deathXpLoss(NaN,500),0);assert.equal(deathXpLoss(1000,-1),0);
  console.log('Final-actor death settlement and replay: passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

// The real shared engine's Fairy state is fed into the real settlement, including a later KO.
(async()=>{
 const s=require('../../../packages/shared/dist');
 const stats={level:1,hp:1,sp:50,maxHp:100,maxSp:50,atk:0,matk:0,def:0,mdefPercent:0,accuracy:1000,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,luk:5,attackSpeed:800,moveSpeed:100,masteryEquipment:[]};
 const input={version:2,balanceRulesVersion:1,tickDurationMs:500,maxTicks:120,seed:'fairy-settlement',definitions:{items:{fairy:{type:'consumable',alchemyCategory:'super_tonics',effect:{type:'revive_full_cleanse'}}}},actors:[
  {id:'a',kind:'character',team:'a',position:{row:5,column:4},snapshot:stats,gambits:{lines:[{conditions:[{id:'upon_death'}],action:{id:'use_item',itemId:'fairy'}}]},inventory:{fairy:1}},
  {id:'b',kind:'monster',team:'b',position:{row:5,column:5},snapshot:{...stats,hp:100000,maxHp:100000,atk:30},gambits:{lines:[{conditions:[{id:'always'}],action:{id:'attack'}}]},inventory:{},attackIntervalTicks:2}
 ]};
 let revived;let reviveTick=0;for(;reviveTick<30;reviveTick++){revived=s.replayBattleV2(input,reviveTick);if(revived.actorsAfter.a.inventory.fairy===0)break;}
 assert.equal(revived.actorsAfter.a.hp,100);assert.equal(revived.actorsAfter.a.sp,0);assert.equal(revived.actorsAfter.a.inventory.fairy,0);
 const legacy=s.replayBattleV2({...input,balanceRulesVersion:undefined},reviveTick);
 assert.equal(legacy.actorsAfter.a.sp,50,'old materialized input keeps original Fairy SP on replay');
 await settlement(100,'loss',true,true,revived); // final living flee; KO history does not charge
 const final=s.simulateBattleV2(input);assert.equal(final.actorsAfter.a.hp,0);
 await settlement(final.actorsAfter.a.hp,final.outcome,false,true,final);
 console.log('Engine Fairy fullHP/0SP, legacy replay, flee and later definitive KO verified');
})().catch(e=>{console.error(e);process.exitCode=1});
