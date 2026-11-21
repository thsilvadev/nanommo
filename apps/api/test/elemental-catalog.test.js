const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const items=read('items.json').equipment,monsters=read('monsters.json').monsters,skills=read('skill_trees.json'),statuses=read('status_effects.json').statusEffects;
for(const element of ['earth','water','fire','wind','holy','shadow']){
 const boots=items.find(item=>item.id.startsWith(`equip_shoes_${element}_`));assert.ok(boots);assert.equal(boots.fixedStats.elementalAffinity,element);assert.equal(boots.fixedStats.elementalImmunity,undefined);
}
const treant=monsters.find(mon=>mon.id==='mon_flamingtreant');assert.equal(treant.element,'earth');assert.ok(treant.passiveSkills.includes('monster_skill_flaming_pound'));
for(const monster of monsters){assert.ok(['neutral','earth','water','fire','wind','holy','shadow'].includes(monster.element),monster.id);assert.equal(monster.elementalDamageTakenMultiplier,undefined);assert.equal(monster.elementalResistances,undefined);}
const burn=statuses.find(status=>status.id==='burn');assert.equal(burn.element,'fire');assert.equal(burn.damageType,'magical');assert.equal(burn.burnDamage,'source_matk_div_5');assert.equal(burn.statusDurationTicks,50);assert.equal(burn.damageIntervalTicks,10);
for(const skill of [...Object.values(skills.trees).flat(),...skills.monsterSkills,...skills.legacySkills]){assert.ok(['neutral','earth','water','fire','wind','holy','shadow'].includes(skill.element),skill.id);assert.equal(skill.effect?.burnDurationTicks,undefined);assert.equal(skill.effect?.burnIntervalTicks,undefined);assert.equal(skill.effect?.burnDamage,undefined);}
for(const name of ['items.json','monsters.json','skill_trees.json','status_effects.json','gambit_catalog.json'])assert.deepEqual(read(`apps/frontend/public/data/${name}`),read(name),`${name} public mirror`);
console.log('elemental catalog: boots, roster, canonical skills/Burn, passive and public mirrors passed');
for(const condition of read('gambit_catalog.json').conditions)for(const param of condition.params??[])if(param.name==='element')assert.deepEqual([...param.values].sort(),['earth','water','fire','wind','holy','shadow'].sort(),'Gambits offer exactly the six elemental choices');

assert.ok(fs.existsSync(path.join(root,'apps/frontend/assets/ui/skill-icons/monster_skill_flaming_pound.svg')),'Flaming Pound has its own passive icon');
