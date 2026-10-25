const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DataService } = require('../dist/apps/api/src/modules/data/data.service');

const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
function serviceWith({maps=read('maps.json'), monsters=read('monsters.json'), npcCatalog=read('npc_catalog.json'), npcVendor=read('npc_vendor.json')}={}) {
  const svc=Object.create(DataService.prototype);
  svc.maps=maps;svc.monsters=monsters;svc.npcCatalog=npcCatalog;svc.npcVendor=npcVendor;svc.items=read('items.json');svc.quests=read('quests.json');svc.cookingRecipes=read('cooking_recipes.json');
  return svc;
}
const clone = value => JSON.parse(JSON.stringify(value));
const monologue = "You know I have a name, right? But you'll keep calling me Storage anyway.";

assert.doesNotThrow(()=>serviceWith().validateCatalogues(),'canonical catalogues validate');
assert.throws(()=>serviceWith({maps:{...read('maps.json'),maps:read('maps.json').maps.map(map=>map.id==='map_town'?{...map,npcIds:map.npcIds.filter(id=>id!=='storage')}:map)}}).validateCatalogues(),/must reference canonical Storage/);
assert.throws(()=>serviceWith({maps:{...read('maps.json'),maps:read('maps.json').maps.map(map=>({...map,npcIds:[...(map.npcIds??[]),'ghost_npc']}))}}).validateCatalogues(),/references missing NPC ghost_npc/);
assert.throws(()=>serviceWith({npcCatalog:{...read('npc_catalog.json'),npcs:[...read('npc_catalog.json').npcs,{...read('npc_catalog.json').npcs.find(npc=>npc.id==='storage')}]}}).validateCatalogues(),/Duplicate or missing NPC ID: storage/);
const brokenNpc=clone(read('npc_catalog.json'));brokenNpc.npcs.find(npc=>npc.id==='storage').monologue='Different text';
assert.throws(()=>serviceWith({npcCatalog:brokenNpc}).validateCatalogues(),/exact monologue/);
const duplicateRef=clone(read('maps.json'));duplicateRef.maps[0].npcIds.push('storage');
assert.throws(()=>serviceWith({maps:duplicateRef}).validateCatalogues(),/duplicates NPC reference storage/);
const secondTown=clone(read('maps.json'));secondTown.maps.push({...secondTown.maps[0],id:'town-future',coordinates:{x:0,y:2},npcIds:secondTown.maps[0].npcIds.filter(id=>id!=='storage')});
assert.throws(()=>serviceWith({maps:secondTown}).validateCatalogues(),/Town map town-future must reference canonical Storage/);
console.log('storage-catalog-validation: passed canonical identity, exact monologue, every Town reference, unknown/duplicate map references and future Town requirements');
