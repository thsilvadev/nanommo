const assert=require('node:assert/strict');
const {InventoryService}=require('../dist/apps/api/src/modules/inventory/inventory.service');
const {TownService}=require('../dist/apps/api/src/modules/town/town.service');
const {MarketService}=require('../dist/apps/api/src/modules/market/market.service');
const {MailService}=require('../dist/apps/api/src/modules/mail/mail.service');
const items=require('../../../items.json');
const definitions=Object.values(items).filter(Array.isArray).flat();
const data={getItemById:id=>definitions.find(i=>i.id===id),getNpcVendor:()=>require('../../../npc_vendor.json'),getNpcCatalog:()=>require('../../../npc_catalog.json'),getMapById:()=>({type:'town'}),getBlacksmithRecipes:()=>require('../../../blacksmith_recipes.json')};
const origin={origin:'crafted',craftedRecipeId:'bronze_ingot',npcSellValueAtCraft:27};
const characters=['seller','buyer'].map(id=>({id,name:id,status:'town',currentMapId:'map_town',pendingMapTransition:null,gold:10000,knownItemIds:[]}));
const bags=[{id:'made',characterId:'seller',itemId:'mat_bronze_ingot',location:'inventory',slotIndex:0,quantity:8,instanceData:origin},{id:'drop',characterId:'buyer',itemId:'mat_bronze_ingot',location:'inventory',slotIndex:0,quantity:10,instanceData:null}];
const stores={Character:characters,InventoryItem:bags,MarketOrder:[],MarketDeal:[],MailMessage:[]};let serial=0;
const matches=(row,where)=>Object.entries(where??{}).every(([key,value])=>row[key]===value);
const repos=Object.fromEntries(Object.entries(stores).map(([name,rows])=>[name,{
 find:async({where,order}={})=>rows.filter(r=>matches(r,where)).sort((a,b)=>order?.slotIndex?a.slotIndex-b.slotIndex:0),
 findOne:async({where}={})=>rows.find(r=>matches(r,where))??null,
 count:async({where}={})=>rows.filter(r=>matches(r,where)).length,
 create:r=>({id:'new-'+(++serial),...r}),save:async r=>{if(!rows.includes(r))rows.push(r);return r;},remove:async r=>rows.splice(rows.indexOf(r),1)
}]));
const manager={getRepository:e=>repos[e.name]};const db={transaction:async work=>work(manager)};
repos.InventoryItem.manager=db;repos.Character.manager=db;
const battle={withCharacterQueueLock:async(_id,work)=>work(),runFutureCombatMutation:async(_id,work)=>work(),publishItemsObtained:async()=>{}};
const gateway={publishItemsObtained:async()=>{},publishMailNewItem:async()=>{}};
(async()=>{
 const inv=new InventoryService(repos.InventoryItem,repos.Character,data);
 await inv.splitStack('seller','made',3);
 let split=bags.find(r=>r.characterId==='seller'&&r.id!=='made');assert.deepEqual(split.instanceData,origin);
 await inv.transferInventoryRow('seller',split.id,'inventory','warehouse');
 await inv.transferInventoryRow('seller',split.id,'warehouse','inventory');assert.deepEqual(split.instanceData,origin);
 await inv.splitStack('seller','made',3); split=bags.find(r=>r.characterId==='seller'&&r.id!=='made');
 const mail=new MailService(data,db,battle,gateway);
 const market=new MarketService(repos.MarketOrder,repos.MarketDeal,repos.InventoryItem,repos.Character,data,battle,mail,db,{publish:async()=>{}},gateway,{announceMarketListing:async()=>{}});
 const {order}=await market.placeSellOrder('seller','mat_bronze_ingot',3,100,{origin:'drop',npcSellValueAtCraft:999999},split.id);
 assert.deepEqual(order.itemInstanceData,origin,'client metadata is ignored');
 await market.purchaseOrder('buyer',order.id,3);
 const delivered=stores.MailMessage.find(m=>m.recipientCharacterId==='buyer');assert.deepEqual(delivered.itemInstanceData,origin);
 await mail.collectAttachments('buyer',delivered.id);
 assert.equal(bags.find(r=>r.id==='drop').quantity,10,'crafted attachment must not merge into dropped stack');
 const collected=bags.find(r=>r.characterId==='buyer'&&r.id!=='drop');assert.deepEqual(collected.instanceData,origin);
 await assert.rejects(()=>mail.collectAttachments('buyer',delivered.id),/already been collected/);
 const town=new TownService(repos.Character,repos.InventoryItem,data,inv,{},battle,{});
 const payout=await town.sellToVendor('buyer','william','mat_bronze_ingot',3,collected.id);assert.equal(payout.goldReceived,81);

 const recipe=require('../../../blacksmith_recipes.json').recipes.find(r=>r.id==='bronze_ingot');
 const {recipeVersion}=require('../dist/apps/api/src/modules/town/recipe-version');
 characters.find(c=>c.id==='buyer').craftingSession={id:'batch',profession:'blacksmith',recipeId:recipe.id,recipeVersion:recipeVersion(recipe),quantity:1,outputItemId:recipe.outputItemId,ingredients:recipe.ingredients};
 for(const [itemId,quantity,instanceData] of [['mat_bronze_ore',20,null],['mat_coal',20,null],['mat_bronze_ingot',1,origin]])bags.push({id:'bag-'+(++serial),characterId:'buyer',itemId,quantity,instanceData,location:'inventory',slotIndex:bags.filter(r=>r.characterId==='buyer').length});
 while(bags.filter(r=>r.characterId==='buyer').length<50)bags.push({id:'filler-'+(++serial),characterId:'buyer',itemId:'equip_sword_t1',quantity:1,location:'inventory',slotIndex:bags.filter(r=>r.characterId==='buyer').length});
 const compatibleMail=await mail.sendSystemMail('buyer','Merge', '', undefined,{itemId:'mat_bronze_ingot',quantity:1,itemInstanceData:origin});
 await mail.collectAttachments('buyer',compatibleMail.id);
 assert.equal(bags.filter(r=>r.characterId==='buyer').length,50,'full inventory accepts a compatible attachment when the remaining craft still fits');
 console.log('Real split -> Storage -> Market -> Mail -> NPC flow preserved crafted origin and 27g unit value');
})().catch(e=>{console.error(e);process.exitCode=1});
