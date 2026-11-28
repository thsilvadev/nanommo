const assert=require('node:assert/strict');
const {resolveDrops}=require('../../../packages/shared/dist');
const baseline=require('../../../docs/handoffs/2026-11-27-balance-baseline.json');
const {monsters}=require('../../../monsters.json');
const items=require('../../../items.json');
const {maps}=require('../../../maps.json');
const fs=require('node:fs');
const spec=fs.readFileSync(require('node:path').join(__dirname,'../../../docs/superpowers/specs/2026-11-27-professions-economy-survival-design.md'),'utf8');
for(const [,material,names,chance] of spec.matchAll(/\| (Leather|Wood|Silkthread|Glue) \| ([^|]+) \|\s*(\d+)%\|/g))for(const name of names.trim().split(',').map(x=>x.trim())) {
 const monster=monsters.find(m=>m.id==='mon_'+name);
 assert.ok(monster, name);
 assert.ok(monster.drops.some(d=>d.itemId==='mat_'+material.toLowerCase()&&d.chance===Number(chance)/100),name+' material');
}
for(const m of monsters)assert.ok(m.drops.some(d=>/^mat_(leather|wood|silkthread|glue)$/.test(d.itemId)&&d.chance<=.2),m.id+' covered');
for(const old of baseline.original_monster_drop_tables){
 const current=monsters.find(m=>m.id===old.id);
 assert.deepEqual(current.drops.slice(0,old.drops.length),old.drops,old.id+' old indexes stable');
 const newIds=new Set(current.drops.slice(old.drops.length).map(d=>d.itemId));
 for(let killIndex=0;killIndex<200;killIndex++) assert.deepEqual(resolveDrops(current,'map_green_grounds_0',items,killIndex).filter(d=>!newIds.has(d.itemId)),resolveDrops(old,'map_green_grounds_0',items,killIndex));
}
for(const [,mapId,pool] of spec.matchAll(/\| ([a-z]+_[a-z_]*\d) \| ([^|]+) \|/g)){
 const expected=pool.trim().split(',').map(x=>{const [,id,weight]=x.match(/^([a-z_]+)(\d+)$/);return {itemId:'mat_'+id,weight:Number(weight)}});
 assert.deepEqual(maps.find(m=>m.id==='map_'+mapId)?.gatheringPool,expected,mapId);
}
for(const id of ['leather','wood','silkthread','glue','coal','iron_ingot'])assert.equal(items.materials.find(i=>i.id==='mat_'+id)?.maxStack,20);
console.log('Regional catalog and 6400 legacy seeded drops passed');
