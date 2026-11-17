const assert=require('node:assert/strict');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
const service=Object.create(SharedBattleService.prototype);
const actor={id:'a',kind:'character',team:'a',inventory:{},snapshot:{level:1,maxHp:100,maxSp:100,masteryEquipment:[]}};
const monster={id:'monster:a:0',kind:'monster',team:'b',definitionId:'mob'};
const row={id:'battle',state:'started',mapId:'field',seed:'seed',revision:1,startAt:new Date(0),endAt:new Date(1000),snapshot:{actors:[actor,monster]},log:{outcome:'win',durationTicks:2,events:[],actorsAfter:{a:{hp:100,sp:100,inventory:{},statusEffects:[],cooldowns:{},foodBuffs:[]}}},result:{roster:[]}};
const events=[],results=[];
const repo={save:async value=>value,findOneBy:async()=>null};
const manager={getRepository:()=>repo,query:async(sql,args)=>{
 if(sql.startsWith('SELECT * FROM shared_battles'))return [row];
 if(sql.startsWith('INSERT INTO party_outbox'))events.push({event:args[2],payload:JSON.parse(args[3])});
 if(sql.startsWith('UPDATE shared_battle_participants'))results.push(JSON.parse(args[2]));
 return [];
}};
Object.assign(service,{data:{getMonsterById:()=>({id:'mob',xpReward:0,level:1,drops:[{itemId:'loot',chance:1}]}),getItems:()=>({}),getGlobalItemDrops:()=>({drops:[]})},inventory:{canFitInventoryDrop:async()=>false,addItem:async()=>{throw Error('full inventory received loot')}},quests:{recordBattleVictory:async()=>{}}});
(async()=>{const ctx={party:{id:'p',mapId:'field'},characters:[{id:'a',hpCurrent:100,spCurrent:100,level:1,xp:0,dietLevels:{},knownItemIds:[]}],manager,now:1000};await service.resolve(ctx,row,async()=>{});assert.deepEqual(results[0].drops,[],'participant result must omit items discarded by capacity');assert.deepEqual(events.find(x=>x.event==='battle:resolved').payload.drops,[],'outbox must report only granted loot');console.log('party-rewards-capacity passed');})().catch(e=>{console.error(e);process.exitCode=1});
