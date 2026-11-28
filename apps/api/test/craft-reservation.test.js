const assert=require('node:assert/strict');
const {TownService}=require('../dist/apps/api/src/modules/town/town.service');
const {InventoryService}=require('../dist/apps/api/src/modules/inventory/inventory.service');
const {recipeVersion}=require('../dist/apps/api/src/modules/town/recipe-version');
const items=Object.values(require('../../../items.json')).filter(Array.isArray).flat();
const recipe=require('../../../blacksmith_recipes.json').recipes.find(r=>r.id==='bronze_ingot');
const data={getItemById:id=>items.find(i=>i.id===id),getNpcVendor:()=>require('../../../npc_vendor.json'),getNpcCatalog:()=>require('../../../npc_catalog.json'),getBlacksmithRecipes:()=>({recipes:[recipe]}),getMapById:()=>({type:'town'})};
function fixture(){
 const character={id:'c',gold:1000,status:'town',currentMapId:'map_town',pendingMapTransition:null,craftingSession:{id:'job',recipeId:recipe.id,recipeVersion:recipeVersion(recipe),profession:'blacksmith',quantity:1,outputItemId:recipe.outputItemId,ingredients:recipe.ingredients}};
 const rows=[{id:'ore',itemId:'mat_bronze_ore',quantity:20},{id:'coal',itemId:'mat_coal',quantity:20},{id:'craftedPotion',itemId:'pot_hp_small',quantity:1,instanceData:{origin:'crafted',craftedRecipeId:'old',npcSellValueAtCraft:1}},...Array.from({length:46},(_,i)=>({id:'f'+i,itemId:'equip_sword_t1',quantity:1}))].map((r,i)=>({...r,characterId:'c',slotIndex:i,location:'inventory'}));
 const repo={find:async({where}={})=>rows.filter(r=>Object.entries(where??{}).every(([k,v])=>r[k]===v)),findOne:async({where})=>rows.find(r=>Object.entries(where).every(([k,v])=>r[k]===v)),count:async()=>rows.length,create:r=>({id:'new',...r}),save:async r=>{if(!rows.includes(r))rows.push(r);return r},remove:async r=>rows.splice(rows.indexOf(r),1)};
 const chars={findOne:async()=>character,save:async r=>r};const manager={getRepository:e=>e.name==='Character'?chars:repo};const db={transaction:async work=>work(manager)};repo.manager=db;chars.manager=db;
 return {character,rows,repo,chars,inv:new InventoryService(repo,chars,data),town:new TownService(chars,repo,data)};
}
(async()=>{
 let h=fixture();await assert.rejects(()=>h.town.buyFromVendor('c','william','pot_hp_small',1),/reserved/i);assert.equal(h.rows.length,49);
 h=fixture();h.rows.push({id:'stored',characterId:'c',location:'warehouse',slotIndex:0,itemId:'pot_hp_small',quantity:1,instanceData:null});
 await assert.rejects(()=>h.inv.transferInventoryRow('c','stored','warehouse','inventory'),/reserved/i);
 console.log('NPC purchase and storage withdrawal preserve pending craft capacity');
})().catch(e=>{console.error(e);process.exitCode=1});
