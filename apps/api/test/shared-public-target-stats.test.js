const assert=require('node:assert/strict');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
(async()=>{
 const stats={hp:70,sp:12,maxHp:100,maxSp:30,atk:25,matk:9,def:7,mdefPercent:15,accuracy:90,evasion:2,critChance:4};
 const snapshot={...stats,inventory:{secret_item:1},gambits:['private'],cooldowns:{hidden:4},foodBuffs:['secret_food']};
 const row={id:'battle',revision:1,snapshot:{actors:[{id:'hero',kind:'character',team:'a',name:'Hero',snapshot,inventory:{secret_item:1},gambits:['private']},{id:'foe',kind:'monster',team:'b',name:'Treant',definitionId:'mon_flamingtreant',snapshot}]},log:{actorsAfter:{hero:{...snapshot}},events:[],durationTicks:1}};
 const service=Object.create(SharedBattleService.prototype);service.db={query:async()=>[row]};
 const view=await service.publicBattle('hero');
 const monster=view.snapshot.actors.find(a=>a.id==='foe');
 assert.equal(monster.definitionId,'mon_flamingtreant','public monster identity must resolve its portrait and drop catalog');
 for(const actor of view.snapshot.actors)for(const [key,value] of Object.entries(stats))assert.equal(actor.snapshot[key],value,'public target stat '+key);
 const serialized=JSON.stringify(view);for(const secret of ['secret_item','private','hidden','secret_food'])assert(!serialized.includes(secret),'must not expose '+secret);
 console.log('shared-public-target-stats passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
