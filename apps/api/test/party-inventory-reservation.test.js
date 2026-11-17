const assert=require('node:assert/strict');
const {InventoryController}=require('../dist/apps/api/src/modules/inventory/inventory.controller');
(async()=>{
 let removed=0;
 const inventory={removeItem:async()=>{removed++}};
 const characters={getCharacterByUserId:async()=>({id:'char'})};
 const party={serialized:async(_ids,fn)=>fn({manager:{query:async()=>[{battleId:'battle'}]}})};
 const controller=new InventoryController(inventory,characters,{partyCoordinator:()=>party});
 await assert.rejects(()=>controller.removeItem({user:{userId:'user'}},{itemId:'elixir',quantity:1}),/battle/i);
 assert.equal(removed,0,'inventory reserved by shared battle cannot be removed');
 console.log('party-inventory-reservation: active combat inventory protected');
})().catch(e=>{console.error(e);process.exitCode=1});
