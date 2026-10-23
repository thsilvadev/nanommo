const assert = require('node:assert/strict');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity');

const definitions = {
  potion: { id:'potion', type:'consumable', stackable:true, maxStack:20 },
  sword: { id:'sword', type:'equipment', stackable:false, maxStack:1 },
};
function harness(initialRows=[], character={id:'c1',currentMapId:'map_town',status:'town',pendingMapTransition:null}) {
  const rows=initialRows.map(row=>({...row,instanceData:row.instanceData??null}));
  const charRepo={findOne:async({where})=>where.id===character.id?character:null,save:async row=>row};
  const repo={
    find:async({where,order}={})=>{let result=rows.filter(row=>Object.entries(where??{}).every(([key,value])=>row[key]===value));if(order?.slotIndex)result.sort((a,b)=>a.slotIndex-b.slotIndex);return result;},
    findOne:async({where}={})=>rows.find(row=>Object.entries(where??{}).every(([key,value])=>row[key]===value))??null,
    save:async row=>{const i=rows.findIndex(old=>old.id===row.id);if(i<0)rows.push(row);else rows[i]={...row};return row;},
    remove:async row=>{const i=rows.findIndex(old=>old.id===row.id);if(i>=0)rows.splice(i,1);return row;},
    create:row=>({...row,id:row.id??`new-${rows.length}`}),
  };
  const manager={getRepository:entity=>entity===Character?charRepo:repo};
  let transactionTail=Promise.resolve();
  repo.manager={transaction:async fn=>{const prior=transactionTail;let release;transactionTail=new Promise(resolve=>release=resolve);await prior;try{return await fn(manager)}finally{release()}}};
  const data={getMapById:id=>id==='map_town'?{id,type:'town'}:{id,type:'grind'},getItemById:id=>definitions[id]??null};
  return {service:new InventoryService(repo,charRepo,data),rows,character,repo,manager};
}
const row=(id,location,slotIndex,itemId='potion',quantity=5,characterId='c1',instanceData=null)=>({id,characterId,location,slotIndex,itemId,quantity,instanceData});
async function run(){
  let h=harness([row('source','inventory',2,'sword',1,'c1',{rolledAttribute:'STR',rolledValue:4})]);
  const moved=await h.service.transferInventoryRow('c1','source','inventory','warehouse');
  assert.equal(moved.location,'warehouse'); assert.equal(moved.slotIndex,0); assert.deepEqual(moved.instanceData,{rolledAttribute:'STR',rolledValue:4}); assert.equal(h.rows.length,1);

  h=harness([row('mine','inventory',0),row('other','warehouse',0,'potion',5,'c2')]);
  await assert.rejects(()=>h.service.transferInventoryRow('c1','other','warehouse','inventory'),/Source stack not found/);
  assert.equal(h.rows.find(x=>x.id==='other').characterId,'c2');

  const full=Array.from({length:10},(_,i)=>row('w'+i,'warehouse',i,'sword',1));
  full.push(row('source','inventory',0)); h=harness(full);
  const before=JSON.stringify(h.rows);
  await assert.rejects(()=>h.service.transferInventoryRow('c1','source','inventory','warehouse'),/Warehouse is full/);
  assert.equal(JSON.stringify(h.rows),before,'failed capacity check leaves every source/destination row unchanged');

  h=harness([row('source','inventory',0,'potion',5),row('merge','warehouse',0,'potion',10)]);
  await h.service.transferInventoryRow('c1','source','inventory','warehouse');
  assert.equal(h.rows.length,1); assert.equal(h.rows[0].id,'merge'); assert.equal(h.rows[0].quantity,15);

  h=harness([row('source','inventory',0,'potion',5),row('partial','warehouse',0,'potion',18),...Array.from({length:9},(_,i)=>row('w'+(i+1),'warehouse',i+1,'sword',1))]);
  const noRoom=JSON.stringify(h.rows);
  await assert.rejects(()=>h.service.transferInventoryRow('c1','source','inventory','warehouse'),/Warehouse is full/);
  assert.equal(JSON.stringify(h.rows),noRoom,'insufficient compatible merge room plus no free slot rejects without partial merge');

  h=harness([row('source','inventory',0,'potion',5),row('bad-a','warehouse',0,'sword',1),row('bad-b','warehouse',0,'sword',1)]);
  const collision=JSON.stringify(h.rows);
  await assert.rejects(()=>h.service.transferInventoryRow('c1','source','inventory','warehouse'),/Destination slot layout is invalid/);
  assert.equal(JSON.stringify(h.rows),collision,'duplicate destination slot collision is rejected without source mutation');

  h=harness([row('bad-source','inventory',50,'sword',1)]);
  await assert.rejects(()=>h.service.transferInventoryRow('c1','bad-source','inventory','warehouse'),/invalid slot index/);
  assert.equal(h.rows[0].location,'inventory');

  h=harness([row('source','inventory',0,'potion',5),row('partial','warehouse',0,'potion',18),...Array.from({length:8},(_,i)=>row('w'+(i+1),'warehouse',i+1,'sword',1))]);
  await h.service.transferInventoryRow('c1','source','inventory','warehouse');
  assert.equal(h.rows.find(x=>x.id==='partial').quantity,18,'must not partially merge into an incompatible partial room');
  assert.equal(h.rows.find(x=>x.id==='source').location,'warehouse'); assert.equal(h.rows.find(x=>x.id==='source').slotIndex,9);

  h=harness([row('a','inventory',0,'potion',5),row('b','inventory',1,'potion',5)]);
  await assert.rejects(()=>h.service.transferItem('c1','potion',5,'inventory','warehouse'),/Ambiguous source stack/);
  assert.equal(h.rows.length,2);

  h=harness([row('source','inventory',2,'potion',7),row('target','inventory',5,'potion',18)]);
  await h.service.moveItemToSlot('c1','source',5);
  assert.equal(h.rows.find(x=>x.id==='target').quantity,20,'merge fills the target stack to maxStack');
  assert.equal(h.rows.find(x=>x.id==='source').quantity,5,'overflow remains in the source stack');
  assert.equal(h.rows.find(x=>x.id==='source').slotIndex,2,'overflow remains in the source slot');
  assert.equal(h.rows.find(x=>x.id==='target').slotIndex,5,'target stack keeps its slot');

  h=harness([row('source','inventory',2,'potion',5),row('target','inventory',5,'potion',10)]);
  await h.service.moveItemToSlot('c1','source',5);
  assert.equal(h.rows.length,1,'fully merged source row is removed');
  assert.equal(h.rows[0].id,'target'); assert.equal(h.rows[0].quantity,15);

  h=harness([row('source','inventory',2,'potion',7),row('target','inventory',5,'potion',20)]);
  await h.service.moveItemToSlot('c1','source',5);
  assert.equal(h.rows.find(x=>x.id==='source').slotIndex,2,'a full compatible target does not swap same-item stacks');
  assert.equal(h.rows.find(x=>x.id==='source').quantity,7);
  assert.equal(h.rows.find(x=>x.id==='target').slotIndex,5);

  h=harness([row('source','inventory',0)],{id:'c1',currentMapId:'map_lv_1',status:'grinding',pendingMapTransition:null});
  await assert.rejects(()=>h.service.transferInventoryRow('c1','source','inventory','warehouse'),/settled in Town/);
  assert.equal(h.rows[0].location,'inventory');
  await assert.rejects(()=>h.service.getWarehouse('c1'),/only available while settled in Town/,'Warehouse read is denied outside Town');
  await assert.rejects(()=>h.service.addItem('c1','potion',1,'warehouse'),/only be created by an explicit Storage transfer/,'generic grants cannot write Warehouse directly');
  const pendingCharacter={id:'c1',currentMapId:'map_town',status:'town',pendingMapTransition:{destinationMapId:'map_town',reason:'town_request'}};
  h=harness([row('source','inventory',0)],pendingCharacter);
  await assert.rejects(()=>h.service.getWarehouse('c1'),/only available while settled in Town/,'Warehouse reads are denied while a battle return is pending');
  await assert.rejects(()=>h.service.transferInventoryRow('c1','source','inventory','warehouse'),/settled in Town/,'Warehouse writes are denied while a battle return is pending');
  // Two simultaneous transfer attempts serialize at the Character transaction
  // boundary: exactly one moves the row, the other observes the missing source.
  h=harness([row('race-source','inventory',0,'potion',20)]);
  const race=await Promise.allSettled([
    h.service.transferInventoryRow('c1','race-source','inventory','warehouse'),
    h.service.transferInventoryRow('c1','race-source','inventory','warehouse'),
  ]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(race.filter(x=>x.status==='rejected').length,1);
  assert.equal(h.rows.reduce((sum,x)=>sum+x.quantity,0),20,'concurrent transfer cannot duplicate or lose quantity');
  assert.equal(h.rows.length,1); assert.equal(h.rows[0].location,'warehouse');

  const capacity = async (rows, quantity, itemId='potion') => h.service.canFitInventoryDrop('c1',itemId,quantity,{getRepository:()=>({find:async({where})=>rows.filter(row=>Object.entries(where??{}).every(([key,value])=>row[key]===value))})});
  assert.equal(await capacity([row('merge','inventory',0,'potion',15)],5),true,'compatible stack can take the entire drop');
  assert.equal(await capacity([row('partial','inventory',0,'potion',18),...Array.from({length:48},(_,i)=>row('f'+i,'inventory',i+1,'sword',1))],5),true,'insufficient merge space uses one free slot for the whole drop');
  assert.equal(await capacity([row('partial','inventory',0,'potion',18),...Array.from({length:49},(_,i)=>row('f'+i,'inventory',i+1,'sword',1))],5),false,'partial merge without a free slot rejects the whole drop');
  assert.equal(await capacity(Array.from({length:47},(_,i)=>row('f'+i,'inventory',i,'sword',1)),45),true,'a multi-slot drop can split across all required free slots');
  assert.equal(await capacity(Array.from({length:47},(_,i)=>row('f'+i,'inventory',i,'sword',1)),61),false,'drop requiring four slots is rejected when only three remain');
  assert.equal(await capacity(Array.from({length:50},(_,i)=>row('f'+i,'inventory',i,'sword',1)),1,'sword'),false,'a full Inventory rejects non-stackable drops');
  assert.equal(await capacity(Array.from({length:50},(_,i)=>row('warehouse-'+i,'warehouse',i,'sword',1)),1),true,'even a full Warehouse does not consume an Inventory slot');
  console.log('inventory-warehouse-transfer: passed transfer atomicity/concurrency, row isolation, instanceData, merge, free-slot fallback, legacy ambiguity, Town guard and drop-capacity boundary matrix');
}
run().catch(error=>{console.error(error);process.exit(1)});
