const assert = require('node:assert/strict');
const {TownService}=require('../dist/apps/api/src/modules/town/town.service.js');
const {Character}=require('../dist/apps/api/src/database/entities/character.entity.js');
(async()=>{
 const recipe={id:'test',outputItemId:'ingot',ingredients:[{itemId:'ore',quantity:2}],xpReward:5};
 const character={id:'c',blacksmithXp:0,blacksmithLevel:1,craftingSession:{id:'batch',profession:'blacksmith',recipeId:'test',quantity:3,outputItemId:'ingot',outputQuantity:3,ingredients:[{itemId:'ore',quantity:6}],completesAt:new Date(0).toISOString()}};
 const delivered=[],scheduled=[];let ore=6;
 const repo={findOne:async()=>character,save:async()=>character};
 const manager={getRepository:entity=>entity===Character?repo:{find:async()=>[{itemId:'ore',quantity:ore}]}};
 repo.manager={transaction:async fn=>fn(manager)};
 const service=Object.create(TownService.prototype);
 Object.assign(service,{characterRepo:repo,dataService:{getBlacksmithRecipes:()=>({recipes:[recipe]}),getItemById:()=>({id:'ingot',type:'material'})},inventoryService:{removeItem:async(_c,_i,n)=>{ore-=n;},addItem:async(_c,_i,n)=>delivered.push(n)},battleService:{withCharacterQueueLock:async(_c,fn)=>fn(),runFutureCombatMutation:async(_c,fn)=>fn()},bullQueue:{add:async(...args)=>scheduled.push(args)}});
 await service.completeCrafting('c','batch');
 assert.deepEqual(delivered,[1],'each completion delivers just one unit');
 assert.equal(ore,4); assert.equal(character.blacksmithXp,5);
 assert.equal(character.craftingSession.completedQuantity,1);
 assert.equal(scheduled.length,1);
 assert.equal(await service.completeCrafting('c','batch'),null,'early duplicate must not grant rewards');
 for(let i=0;i<2;i++){character.craftingSession.completesAt=new Date(0).toISOString();await service.completeCrafting('c',character.craftingSession.id);}
 assert.deepEqual(delivered,[1,1,1]); assert.equal(character.blacksmithXp,15);assert.equal(ore,0);assert.equal(character.craftingSession,null);
 assert.equal(await service.completeCrafting('c','batch'),null);
 character.craftingSession={id:'cancel-batch',profession:'blacksmith',recipeId:'test',quantity:3,outputItemId:'ingot',ingredients:[{itemId:'ore',quantity:6}],completesAt:new Date(0).toISOString()};ore=6;
 service.assertProfessionNpc=()=>{};service.getProfessionState=async()=>({session:character.craftingSession});service.bullQueue.getJob=async()=>null;
 await service.cancelProfessionCrafting('c','smith','blacksmith','cancel-batch');
 assert.equal(character.craftingSession,null,'cancel at deadline awards due unit and cancels remainder');
 assert.equal(ore,4);assert.equal(character.blacksmithXp,20);
 console.log('profession-batch-progress passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
