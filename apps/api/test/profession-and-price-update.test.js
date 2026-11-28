const assert=require('node:assert/strict');
const {professionThreshold,professionLevelForXp,professionProgressForXp}=require('../../../packages/shared/dist');
assert.equal(typeof professionThreshold,'function','shared profession curve exists');
assert.deepEqual(Array.from({length:11},(_,i)=>professionThreshold(i+1)),[0,20,44,78,128,328,828,1578,2478,3558,4854]);
assert.equal(professionLevelForXp(3558),10);assert.equal(professionProgressForXp(3558).xpIntoLevel,0);
const fs=require('node:fs');const {applyBalanceItemPrices}=require('../../../scripts/apply-balance-item-prices');
const input=JSON.parse(fs.readFileSync('items.json'));
const once=applyBalanceItemPrices(input),twice=applyBalanceItemPrices(once);
assert.deepEqual(twice,once,'baseline is sole input to bonus');
const baseline=require('../../../docs/handoffs/2026-11-27-balance-baseline.json');
const monsters=require('../../../monsters.json').monsters;
for(const old of baseline.original_common_part_prices){
 const item=once.monsterParts.find(i=>i.id===old.id);
 if(old.questOnly){assert.equal(item.sellPriceToVendor,old.sellPriceToVendor);continue;}
 const level=monsters.find(m=>m.id===old.droppedBy[0]).level;
 const payment=Math.floor((old.marketBasePrice??old.sellPriceToVendor)*.4)+2*Math.floor(level/10);
 assert.equal(Math.floor(item.marketBasePrice*.4),payment,old.id);
 assert.equal(item.sellPriceToVendor,payment);
}
for(const vendor of [require('../../../npc_vendor.json'),...require('../../../npc_catalog.json').npcs.map(n=>n.vendor).filter(Boolean)])for(const stock of vendor.sellStock??[])if(stock.itemId==='antidote')assert.equal(stock.price,350);
console.log('Shared progression, baseline-only prices and NPC antidote passed');
// Reapplying the historical update cannot use a later monster-level rebalance as a new baseline.
const originalLevel=monsters[0].level;
try { monsters[0].level=999;assert.equal(applyBalanceItemPrices(input).monsterParts[0].sellPriceToVendor,once.monsterParts[0].sellPriceToVendor,'only original monster levels may influence historical price bonus'); }
finally { monsters[0].level=originalLevel; }
