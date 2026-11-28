const assert=require('node:assert/strict');
const fs=require('node:fs');
const {TownService}=require('../dist/apps/api/src/modules/town/town.service');
(async()=>{
 const c={id:'c',cookingSession:{id:'legacy',recipeId:'blueberry_jelly',outputItemId:'food_blueberry',quantity:99,completedQuantity:3,ingredients:[{itemId:'mat_wild_blueberries',quantity:192}],completesAt:new Date(0).toISOString()}};
 const repo={find:async()=>[{itemId:'mat_wild_blueberries',quantity:192}],findOne:async()=>c,save:async x=>x,manager:{transaction:async work=>work({getRepository:()=>repo})}};
 const service=Object.create(TownService.prototype);
 Object.assign(service,{characterRepo:repo,dataService:{getCookingRecipes:()=>require('../../../cooking_recipes.json')},battleService:{withCharacterQueueLock:async(_id,work)=>work()},inventoryService:{removeItem:async()=>{throw Error('legacy cutover consumed new ingredients');},addItem:async()=>{throw Error('legacy cutover delivered extra unit');}}});
 assert.equal(await service.completeCooking('c','legacy'),null);
 assert.equal(c.cookingSession,null,'legacy reservation is released');
 assert.equal(await service.completeCooking('c','legacy'),null,'old job delivery is a no-op');
 c.cookingSession={id:'legacy-bread',recipeId:'bread',outputItemId:'food_bread',quantity:1,ingredients:[{itemId:'mat_wheat',quantity:1}],completesAt:new Date(0).toISOString()};
 assert.equal(await service.completeCooking('c','legacy-bread'),null);assert.equal(c.cookingSession,null,'unchanged legacy bread also needs a provenance cutover');
 for(const file of ['items','maps','monsters','npc_catalog','npc_vendor','cooking_recipes','alchemy_recipes','blacksmith_recipes'])assert.deepEqual(require('../../../'+file+'.json'),require('../../frontend/public/data/'+file+'.json'),file+' mirror');
 const items=require('../../../items.json');
 for(const item of [...items.materials.filter(i=>['mat_leather','mat_wood','mat_silkthread','mat_glue','mat_coal','mat_iron_ingot'].includes(i.id)),...items.monsterParts.filter(i=>['part_duneraider_common','part_bandit_common'].includes(i.id)),...items.equipment.filter(i=>i.tier===4)]){
  const folder=item.type==='material'?'materials':item.type==='equipment'?'equipment':'monster_parts';
  for(const variant of ['svg','svg-noframe'])assert.ok(fs.existsSync('apps/frontend/assets/ui/items/'+variant+'/'+folder+'/'+item.id+'.svg'),item.id+' icon');
  for(const locale of ['pt-BR','en-US'])assert.ok(item.locales?.[locale]?.name,item.id+' '+locale);
 }
 console.log('Cutover cancellation, retry, mirror and assets passed');
})().catch(e=>{console.error(e);process.exitCode=1});
