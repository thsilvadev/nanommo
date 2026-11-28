const assert=require('node:assert/strict');
const {recipes}=require('../../../blacksmith_recipes.json');
const items=require('../../../items.json');
const recipe=id=>{const r=recipes.find(r=>r.id===id);assert(r,id+' exists');return r;};
const count=(id,ingredient)=>recipe(id).ingredients.find(i=>i.itemId===ingredient)?.quantity??0;
assert.equal(count('bronze_ingot','mat_bronze_ore'),3);assert.equal(count('bronze_ingot','mat_coal'),1);
for(const [tier,metal,wood,silk,glue,rare] of [[2,4,5,5,2,1],[3,6,10,10,3,3],[4,12,15,15,4,7]]){
 assert.equal(count('bow_t'+tier,tier===4?'mat_iron_ingot':'mat_bronze_ingot'),metal);
 assert.equal(count('bow_t'+tier,'mat_wood'),wood);assert.equal(count('bow_t'+tier,'mat_silkthread'),silk);assert.equal(count('bow_t'+tier,'mat_glue'),glue);
 for(const r of recipes.filter(r=>r.outputItemId.endsWith('_t'+tier))){assert.equal(r.ingredients.filter(i=>i.itemId.endsWith('_rare')).reduce((s,i)=>s+i.quantity,0),rare,r.id+' rare units');if(tier===4)assert.equal(r.availability,'future');}
}
assert.equal(count('shield_t3','mat_wood'),0);assert.equal(count('shield_t3','mat_bronze_ingot'),16);assert.equal(count('rune_t3','part_unicorn_rare'),3);assert.equal(count('rune_t3','part_slime_common'),3);
assert.equal(items.equipment.filter(i=>i.tier===4).length,16);
for(const r of recipes.filter(r=>r.availability==='future'))assert.ok(r.ingredients.some(i=>i.itemId==='mat_iron_ingot'));
assert.ok(!JSON.stringify(require('../../../monsters.json')).includes('mat_iron_ingot'));
assert.ok(!JSON.stringify(items).includes('mat_iron_ore'));
console.log('Crafting tiers, catalysts and unavailable iron passed');
