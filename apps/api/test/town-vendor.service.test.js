const assert = require('node:assert/strict');
const { TownService } = require('../dist/apps/api/src/modules/town/town.service');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity');

const items = {
  pot_hp_small: { id:'pot_hp_small', name:'Small HP Potion', type:'consumable', stackable:true, maxStack:20, sellPriceToVendor:7 },
  pot_hp_medium: { id:'pot_hp_medium', name:'Medium HP Potion', type:'consumable', stackable:true, maxStack:20, sellPriceToVendor:7 },
  sword: { id:'sword', name:'Test Sword', type:'equipment', stackable:false, sellPriceToVendor:100 },
};

function harness(character, rows=[]) {
  const state = { character, rows: rows.map(r=>({...r})), savedCharacter:false };
  const managerRepo = (entity) => {
    if (entity === Character) return {
      findOne: async()=>state.character,
      save: async(c)=>{state.character=c;state.savedCharacter=true;return c;},
    };
    return {
      find: async(opts)=>state.rows.filter(r=>r.characterId===opts.where.characterId && r.location===opts.where.location && (!opts.where.itemId || r.itemId===opts.where.itemId)).sort((a,b)=>a.slotIndex-b.slotIndex),
      count: async(opts)=>state.rows.filter(r=>r.characterId===opts.where.characterId && r.location===opts.where.location).length,
      create: (v)=>({...v,id:'new-'+Date.now()}),
      save: async(r)=>{const i=state.rows.findIndex(x=>x.id===r.id);if(i>=0)state.rows[i]={...r};else state.rows.push(r);return r;},
      remove: async(r)=>{state.rows=state.rows.filter(x=>x.id!==r.id);},
    };
  };
  const manager = { getRepository: managerRepo };
  const characterRepo = { manager:{transaction:async(fn)=>fn(manager)} };
  const inventoryRepo = { find: async(opts)=>state.rows.filter(r=>r.characterId===opts.where.characterId && r.location===opts.where.location), count: async(opts)=>state.rows.filter(r=>r.characterId===opts.where.characterId && r.location===opts.where.location).length };
  const data = {
    getNpcVendor:()=>({id:'william',name:'William',type:'vendor',location:'town',buysAnyItem:true,buyRatePercent:40,sellStock:[{itemId:'pot_hp_small',price:15,infiniteStock:true},{itemId:'pot_hp_medium',price:40,infiniteStock:true}]}),
    getItemById:(id)=>items[id]||null,
  };
  return {service:new TownService(characterRepo,inventoryRepo,data),state};
}

async function run(){
  let {service,state}=harness({id:'c1',status:'town',gold:100});
  const stock=await service.getVendorStock('william');
  assert.equal(stock.length,2);
  assert.equal(stock[0].buyPrice,15);

  await service.buyFromVendor('c1','william','pot_hp_small',2);
  assert.equal(state.character.gold,70);
  assert.equal(state.rows.find(r=>r.itemId==='pot_hp_small').quantity,2);

  await service.sellToVendor('c1','william','pot_hp_small',1);
  assert.equal(state.character.gold,72);
  assert.equal(state.rows.find(r=>r.itemId==='pot_hp_small').quantity,1);

  await assert.rejects(()=>service.buyFromVendor('c1','william','pot_hp_small',7),/Not enough gold/);
  assert.equal(state.character.gold,72);

  await assert.rejects(()=>service.buyFromVendor('c1','william','pot_hp_medium',0),/positive integer/);
  await assert.rejects(()=>service.buyFromVendor('c1','william','pot_hp_medium',-1),/positive integer/);
  await assert.rejects(()=>service.buyFromVendor('c1','william','sword',1),/Item is not sold/);

  ({service,state}=harness({id:'c2',status:'grinding',gold:100},[{id:'i1',characterId:'c2',location:'inventory',slotIndex:0,itemId:'pot_hp_small',quantity:2}]));
  await assert.rejects(()=>service.sellToVendor('c2','william','pot_hp_small',1),/only available in Town/);
  assert.equal(state.rows[0].quantity,2);

  ({service,state}=harness({id:'c3',status:'town',gold:100},Array.from({length:50},(_,i)=>({id:'i'+i,characterId:'c3',location:'inventory',slotIndex:i,itemId:'other',quantity:1}))));
  await assert.rejects(()=>service.buyFromVendor('c3','william','pot_hp_small',1),/Inventory is full/);
  assert.equal(state.character.gold,100);

  console.log('town-vendor.service.test.js: 10 assertions passed');
}
run().catch(err=>{console.error(err);process.exit(1);});
