const assert=require('node:assert/strict');
const fs=require('node:fs');
const spec=fs.readFileSync('docs/superpowers/specs/2026-11-27-professions-economy-survival-design.md','utf8');
for(const [section,file,prefix] of [['Cooking','cooking_recipes','mat_'],['Alchemy','alchemy_recipes','']]) {
 const text=spec.split('## '+section+'\n')[1].split('\n## ')[0];
 for(const [,id,level,ingredients,xp] of text.matchAll(/\| ([a-z_]+) \|(\d+)\|([^|]+)\|(\d+)\|/g)) {
  const recipe=require('../../../'+file+'.json').recipes.find(r=>r.id===id);
  assert.equal(recipe.requiredLevel,Number(level));assert.equal(recipe.xpReward,Number(xp),id+' XP');
  const expected=ingredients.split(',').map(x=>{const [,id,quantity]=x.match(/^([a-z_]+)(\d+)$/);return {itemId:prefix+id,quantity:Number(quantity)};});
  assert.deepEqual(recipe.ingredients,expected,id+' ingredients');
 }
}
console.log('All Cooking/Alchemy recipe rows match spec');
