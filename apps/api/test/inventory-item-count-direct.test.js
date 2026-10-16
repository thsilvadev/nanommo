const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity');

function inventoryServiceWithRows(rows) {
  const repo = {
    async find({ where, order } = {}) {
      const filtered = rows.filter(row => Object.entries(where ?? {}).every(([key, value]) => row[key] === value));
      if (order?.slotIndex === 'ASC') filtered.sort((a,b) => a.slotIndex-b.slotIndex);
      return filtered;
    },
    async save(row) { return row; },
    async remove(row) { const index=rows.indexOf(row); if(index>=0) rows.splice(index,1); },
  };
  const service=Object.create(InventoryService.prototype);
  service.inventoryItemRepo=repo;service.characterRepo={};service.dataService={getItemById:()=>null};
  return {service,repo,rows};
}

(async()=>{
  const rows=[
    {id:'inv-a',characterId:'char-1',location:'inventory',slotIndex:0,itemId:'food_bread',quantity:2},
    {id:'inv-b',characterId:'char-1',location:'inventory',slotIndex:1,itemId:'food_bread',quantity:3},
    {id:'warehouse-a',characterId:'char-1',location:'warehouse',slotIndex:0,itemId:'food_bread',quantity:99},
  ];
  const h=inventoryServiceWithRows(rows);
  assert.equal(await h.service.getItemCount('char-1','food_bread'),5,'count sums every inventory stack and ignores Warehouse');
  await h.service.removeItem('char-1','food_bread',4);
  assert.equal(rows.find(row=>row.id==='inv-a')?.quantity,undefined,'fully consumed source row is removed');
  assert.equal(rows.find(row=>row.id==='inv-b').quantity,1,'remaining required quantity comes from Inventory only');
  assert.equal(rows.find(row=>row.id==='warehouse-a').quantity,99,'manual/combat consumption cannot consume Warehouse rows');
  assert.equal(await h.service.getItemCount('char-1','food_bread'),1);

  const battle=Object.create(BattleService.prototype);
  const consumptionCalls=[];
  battle.dataService={getItemById:(id)=>({id,type:'food',effect:{type:'food_buff',durationSeconds:3600,hpRegenPerTenTicks:4,spRegenPerTenTicks:1}})};
  battle.inventoryService={
    async getItemCount(_characterId,_itemId){return 1;},
    async consumeFood(_characterId,itemId){consumptionCalls.push(itemId);throw new BadRequestException('Insufficient item quantity');},
  };
  const past='2020-01-01T00:00:00.000Z';
  const character={id:'char-1',autoFeed:true,pendingMapTransition:null,
    diet:[{itemId:'food_bread',consumedAt:past,digestUntil:past,dietLevel:0}],
    dietLevels:{food_bread:{level:0,lastDigestUntil:past}},
  };
  assert.equal(await battle.tryAutoFeed(character,0,{}),false,'Auto Feed skips a candidate that disappeared after eligibility and does not fail battle resolution');
  assert.deepEqual(consumptionCalls,['food_bread']);

  const raceRows=[{id:'warehouse-only',characterId:'char-1',location:'warehouse',slotIndex:0,itemId:'food_bread',quantity:20}];
  const warehouseOnly=inventoryServiceWithRows(raceRows);
  assert.equal(await warehouseOnly.service.getItemCount('char-1','food_bread'),0,'Warehouse-only food is unavailable to Auto Feed/Gambits/manual use');
  console.log('inventory-item-count-direct: passed multi-stack summation, Inventory-only consumption, warehouse-only exclusion and Auto Feed race skip');
})().catch(error=>{console.error(error);process.exit(1)});
