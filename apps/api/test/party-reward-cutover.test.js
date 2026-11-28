const assert=require('node:assert/strict');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
const catalog=require('../../../items.json');
const current=require('../../../monsters.json').monsters.find(m=>m.id==='mon_slime');
const old=require('../../../docs/handoffs/2026-11-27-balance-baseline.json').original_monster_drop_tables.find(m=>m.id==='mon_slime');
const global=require('../../../global_item_drops.json');
async function settle(definition,version){
 const service=Object.create(SharedBattleService.prototype),grants=[];
 const players=['a','b'].map(id=>({id,kind:'character',team:'a',inventory:{},snapshot:{level:1,maxHp:100,maxSp:50,masteryEquipment:[]}}));
 const monster={id:'monster:a:0',kind:'monster',team:'b',definitionId:'mon_slime'};
 const row={id:'battle',state:'started',mapId:'map_green_grounds_0',seed:'s',revision:1,startAt:new Date(0),endAt:new Date(1000),snapshot:{balanceRulesVersion:version,rewardSnapshot:{monsters:{mon_slime:definition},items:catalog,globalItemDrops:global.drops},actors:[...players,monster]},log:{outcome:'win',durationTicks:2,events:[],actorsAfter:Object.fromEntries(players.map(a=>[a.id,{hp:100,sp:50,inventory:{},statusEffects:[],cooldowns:{},foodBuffs:[]}]))},result:{roster:[{characterId:'a',killIndex:5053}]}};
 const repo={save:async x=>x,findOneBy:async()=>null};
 const manager={getRepository:()=>repo,query:async(sql,args)=>{if(sql.startsWith('SELECT * FROM shared_battles'))return[row];if(sql.startsWith('UPDATE shared_battles SET state='))row.state=args[1];return[];}};
 Object.assign(service,{data:{getMonsterById:()=>current,getItems:()=>catalog,getGlobalItemDrops:()=>global,getXpToNextLevel:()=>1000},inventory:{canFitInventoryDrop:async()=>true,addItem:async(id,itemId)=>grants.push({id,itemId})},quests:{recordBattleVictory:async()=>{}}});
 await service.resolve({characters:players.map(a=>({id:a.id,level:1,xp:0,unspentAttributePoints:0,dietLevels:{},knownItemIds:[]})),manager,now:1000},row,async()=>{});
 return grants;
}
(async()=>{
 const before=await settle({...current,drops:old.drops},undefined);
 assert.ok(!before.some(d=>d.itemId==='mat_glue'),'legacy snapshot must not gain new materials');
 const after=await settle(current,1);
 assert.ok(after.some(d=>d.itemId==='mat_glue'),'new independent material roll is active at this seed');
 assert.deepEqual(after.filter(d=>d.itemId!=='mat_glue'),before,'old drops and global recipients retain original streams');
 console.log('Party frozen legacy rewards and independent material recipients passed');
})().catch(e=>{console.error(e);process.exitCode=1});
