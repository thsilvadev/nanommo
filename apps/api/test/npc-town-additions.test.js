const assert = require('assert');
const { TownService } = require('../dist/apps/api/src/modules/town/town.service');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity');
const catalog = require('../../../npc_catalog.json');
const items = require('../../../items.json');
const allItems = [...(items.consumables || []), ...(items.equipment || []), ...(items.monsterParts || [])];
const itemById = id => allItems.find(x => x.id === id);

function harness(rows, character = { id:'c1', status:'town', currentMapId:'map_town', pendingMapTransition:null, hpCurrent:1, spCurrent:1, str:5, agi:5, dex:5, vit:5, int:5, sor:5 }) {
  const charRepo = { findOne: async () => character, save: async x => x };
  const invRepo = {
    find: async () => rows,
    count: async ({ where }) => rows.filter(r => r.characterId === where.characterId && r.location === where.location).length,
    save: async x => { if (!rows.includes(x)) rows.push(x); return x; },
    remove: async x => { const i=rows.indexOf(x); if(i>=0) rows.splice(i,1); return x; },
    create: x => x,
  };
  const manager = { getRepository: entity => entity === Character ? charRepo : invRepo };
  charRepo.manager = { transaction: async fn => fn(manager) };
  const data = {
    getNpcCatalog: () => catalog,
    getNpcVendor: () => ({ id:'william', name:'William', type:'vendor', location:'town', buysAnyItem:true, buyRatePercent:40, sellStock:[] }),
    getItemById: itemById,
  };
  const characterService = { getDerivedStatsForCharacter: async () => ({ maxHp:123, maxSp:45 }) };
  const inventoryService = { consumeFood: async (id, itemId, manager) => { character.activeFoodBuff={itemId,expiresAt:new Date(Date.now()+3600000).toISOString(),hpRegenPerTenTicks:4,spRegenPerTenTicks:1}; return character; } };
  return { service:new TownService(charRepo, invRepo, data, inventoryService, characterService), character };
}

async function run() {
  let rows = [
    {id:'s',characterId:'c1',location:'inventory',slotIndex:0,itemId:'part_slime_common',quantity:3},
    {id:'g',characterId:'c1',location:'inventory',slotIndex:1,itemId:'part_cindergolem_common',quantity:1},
    {id:'v',characterId:'c1',location:'inventory',slotIndex:2,itemId:'part_venomviper_common',quantity:1},
  ];
  let {service,character}=harness(rows);
  const npcs = await service.getTownNPCs('c1');
  assert.ok(npcs.some(n=>n.id==='blacksmith_loren' && n.types.includes('vendor')));
  assert.ok(npcs.some(n=>n.id==='cecilia' && n.types.includes('quest')));

  const stock = await service.getVendorStock('c1','blacksmith_loren');
  assert.deepStrictEqual(stock.map(x=>x.itemId), [
    'equip_sword_t1','equip_greatsword_t1','equip_dagger_t1','equip_bow_t1','equip_staff_t1','equip_wand_t1','equip_shield_t1','equip_body_phys_t1','equip_body_magic_t1'
  ]);
  assert.strictEqual(stock.every(x=>x.infiniteStock), true);
  assert.strictEqual(stock.length, 9);

  let state = await service.getNpcDialogue('c1','cecilia');
  assert.strictEqual(state.nodeId,'greeting');
  state = await service.chooseNpcDialogue('c1','cecilia','ask','greeting');
  assert.strictEqual(state.nodeId,'offer');
  assert.deepStrictEqual(state.choices.map(x=>x.id),['handle_items']);

  state = await service.chooseNpcDialogue('c1','cecilia','handle_items','offer');
  assert.strictEqual(state.nodeId,'reward');
  assert.strictEqual(rows.some(r=>r.itemId==='part_slime_common' || r.itemId==='part_cindergolem_common' || r.itemId==='part_venomviper_common'),false);
  assert.strictEqual(rows.some(r=>r.itemId==='equip_accessory_sor_t1' && r.quantity===1),true);

  rows = [
    {id:'s',characterId:'c1',location:'inventory',slotIndex:0,itemId:'part_slime_common',quantity:2},
  ];
  ({service,character}=harness(rows));
  state = await service.getNpcDialogue('c1','cecilia');
  state = await service.chooseNpcDialogue('c1','cecilia','ask','greeting');
  assert.deepStrictEqual(state.choices.map(x=>x.id),['return_later']);

  character.hpCurrent=1; character.spCurrent=2;
  await service.getNpcDialogue('c1','father_marcelus');
  assert.strictEqual(character.hpCurrent,123);
  assert.strictEqual(character.spCurrent,45);

  character.status='town'; character.currentMapId='map_green_grounds';
  await assert.rejects(()=>service.getNpcDialogue('c1','cecilia'),/only available in Town/);
  character.currentMapId='map_town'; character.pendingMapTransition={destinationMapId:'map_town',reason:'town_request'};
  await assert.rejects(()=>service.getNpcDialogue('c1','cecilia'),/only available in Town/);

  console.log('Town NPC additions: 14 assertions passed');
}
run().catch(error => { console.error(error); process.exit(1); });
