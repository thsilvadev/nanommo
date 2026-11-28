const assert=require('node:assert/strict');
const {QuestService}=require('../dist/apps/api/src/modules/quests/quest.service');
(async()=>{
 const service=Object.create(QuestService.prototype);
 const row={id:'gel',itemId:'part_slime_common',quantity:3,instanceData:null};
 const character={craftingSession:{ingredients:[{itemId:row.itemId,quantity:3}]}};
 let mutations=0;
 const manager={getRepository:e=>e.name==='Character'?{findOne:async()=>character}:{find:async()=>[row],save:async()=>mutations++,remove:async()=>mutations++}};
 service.data={getItemById:()=>({type:'monster_part'})};
 await assert.rejects(()=>service.consumeRequirements(manager,'c','quest',[{itemId:row.itemId,quantity:1}]),/reserved/i);
 assert.equal(row.quantity,3);assert.equal(mutations,0);
 console.log('Quest turn-in preserves materials reserved by an active recipe');
})().catch(e=>{console.error(e);process.exitCode=1});
