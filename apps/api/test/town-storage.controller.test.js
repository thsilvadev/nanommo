const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { TownController } = require('../dist/apps/api/src/modules/town/town.controller');
const { InventoryController } = require('../dist/apps/api/src/modules/inventory/inventory.controller');

(async()=>{
  const calls=[];
  const characters={
    'user-a':{id:'char-a'},
    'user-b':{id:'char-b'},
  };
  const characterService={async getCharacterByUserId(userId){return characters[userId]??null;}};
  const townService={
    async getWarehouse(id){calls.push(['town-read',id]);return [{id:'a-stack',characterId:id,location:'warehouse',quantity:1}];},
    async getWarehouseCapacity(id){calls.push(['capacity',id]);return {used:1,max:10};},
    async transferWarehouseRow(...args){calls.push(['row-transfer',...args]);return {id:args[1]};},
    async depositToWarehouse(...args){calls.push(['legacy-deposit',...args]);},
    async withdrawFromWarehouse(...args){calls.push(['legacy-withdraw',...args]);},
  };
  const town=new TownController(townService,characterService);
  const fromA=await town.getWarehouse({user:{userId:'user-a'}});
  const fromB=await town.getWarehouse({user:{userId:'user-b'}});
  assert.equal(fromA[0].characterId,'char-a');assert.equal(fromB[0].characterId,'char-b');
  await town.transferWarehouseRow({user:{userId:'user-a'}},{rowId:'a-stack',direction:'deposit'});
  await town.transferWarehouseRow({user:{userId:'user-b'}},{rowId:'b-stack',direction:'withdraw'});
  assert.deepEqual(calls.filter(c=>c[0]==='row-transfer'),[
    ['row-transfer','char-a','a-stack','deposit'],
    ['row-transfer','char-b','b-stack','withdraw'],
  ],'controller derives character identity from JWT user, never request body');
  await assert.rejects(()=>town.transferWarehouseRow({user:{userId:'user-a'}},{rowId:'',direction:'deposit'}),error=>error instanceof BadRequestException);
  await assert.rejects(()=>town.transferWarehouseRow({user:{userId:'user-a'}},{rowId:'a-stack',direction:'move'}),error=>error instanceof BadRequestException);

  const inventoryService={async getWarehouse(id){calls.push(['legacy-read',id]);return [];},async transferToWarehouse(...args){calls.push(['legacy-to',...args]);},async transferFromWarehouse(...args){calls.push(['legacy-from',...args]);}};
  const inventory=new InventoryController(inventoryService,characterService,{});
  await inventory.getWarehouse({user:{userId:'user-a'}});
  await inventory.transferToWarehouse({user:{userId:'user-b'}},{itemId:'potion',quantity:20});
  await inventory.transferFromWarehouse({user:{userId:'user-a'}},{itemId:'potion',quantity:20});
  assert.deepEqual(calls.filter(c=>c[0]==='legacy-read'),[['legacy-read','char-a']]);
  assert.deepEqual(calls.filter(c=>c[0]==='legacy-to'),[['legacy-to','char-b','potion',20]]);
  assert.deepEqual(calls.filter(c=>c[0]==='legacy-from'),[['legacy-from','char-a','potion',20]]);
  console.log('town-storage.controller: passed JWT-owned character isolation and valid/invalid row-ID transfer requests');
})().catch(error=>{console.error(error);process.exit(1)});
