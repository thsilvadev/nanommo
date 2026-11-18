const assert=require('node:assert/strict'),fs=require('node:fs');
const {ChatService}=require('../dist/apps/api/src/modules/chat/chat.service');
(async()=>{
 const ids=require('../../../craft_announcements.json').enabledItemIds;
 const outputs=['cooking','alchemy','blacksmith'].flatMap(p=>require('../../../'+p+'_recipes.json').recipes.map(r=>r.outputItemId));
 assert.deepEqual(new Set(ids),new Set(outputs));
 const svc=Object.create(ChatService.prototype);const rows=[],published=[],seen=new Set();
 const redis={set:async key=>{if(seen.has(key))return null;seen.add(key);return 'OK';},multi:()=>{const m={lpush:(_key,row)=>{rows.unshift(row);return m;},ltrim:()=>m,exec:async()=>[]};return m;},publish:async(_channel,row)=>published.push(JSON.parse(row)),lrange:async()=>rows};
 Object.assign(svc,{redis,dataService:{getCraftAnnouncementItemIds:()=>['ingot'],getItemById:()=>({name:'Bronze Ingot'})},logger:{error:msg=>{throw new Error(msg);}}});
 await svc.announceCraft('c','Hero','ingot','unit1');await svc.announceCraft('c','Hero','ingot','unit1');await svc.announceCraft('c','Hero','common','unit2');
 assert.equal(rows.length,1);assert.equal(published.length,1);assert.equal(published[0].channel,'crafts');assert.equal(published[0].message,'Hero crafted Bronze Ingot.');
 assert.equal((await svc.getChatHistory('crafts'))[0].id,'craft:unit1');
 await assert.rejects(()=>svc.sendChatMessage('c','crafts','fake'),/Only the Global/);
 console.log('craft-announcements passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
