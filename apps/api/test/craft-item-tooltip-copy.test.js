const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const exported={};new Function('exports',ts.transpileModule(fs.readFileSync('apps/frontend/src/app/core/craft-item-tooltip.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exported);
const lines=exported.craftItemTooltipLines;
const items=Object.values(require('../../../items.json')).flat().filter(i=>i&&i.id);
const item=id=>items.find(i=>i.id===id);
const text=(id,context)=>lines(item(id),context).map(l=>l.label+': '+l.value).join('\n');
assert.match(text('equip_sword_t2',{stats:[{label:'Attack',value:'+28'}]}),/Required level: 8/);
assert.match(text('equip_sword_t2'),/Strength/);assert.match(text('equip_sword_t2'),/\+2.*\+8/);
assert.match(text('antidote'),/Removes Poison/);assert.match(text('antidote'),/10 seconds.*all Potions/);
assert.match(text('fairy_in_a_bottle'),/60 seconds.*all Super Tonics/);
assert.match(text('fairy_in_a_bottle'),/full HP and SP/);
assert.match(text('food_bread'),/4 HP.*1 SP.*every 10 seconds/);assert.doesNotMatch(text('food_bread'),/tick/);
assert.match(text('tonic_fontoura'),/Defense.*15/);assert.match(text('tonic_fontoura'),/30 seconds/);
assert.match(text('mat_bronze_ingot'),/Blacksmith/);
assert.match(text('antidote',{portuguese:true}),/Remove Veneno/);
const ids=new Set(['cooking','alchemy','blacksmith'].flatMap(p=>require('../../../'+p+'_recipes.json').recipes.flatMap(r=>[r.outputItemId,...r.ingredients.map(i=>i.itemId)])));
for(const id of ids){assert(item(id),id);const value=text(id);assert(value.length>20,id+' has player details');assert.doesNotMatch(value,/[a-z]+_[a-z]+|[{}]|"enabled"/,id+' must not expose data keys or JSON');}
const safe=lines({...item('equip_sword_t2'),requiredUnlock:'equipment_access_t2',internalData:{debug:true}}).map(l=>l.value).join(' ');assert.doesNotMatch(safe,/equipment_access|debug/);
console.log('craft-item-tooltip-copy passed');
