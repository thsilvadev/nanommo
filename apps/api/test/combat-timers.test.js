const assert = require('node:assert/strict');
const shared = require('../../../packages/shared/dist');
const item = (category, effect) => ({type:'consumable',alchemyCategory:category,effect});
const items = {
  hp:item('potions',{type:'heal_hp',amount:1}), sp:item('potions',{type:'heal_sp',amount:1}),
  tonic:item('tonics',{type:'apply_status',status:'haste_shot',durationSeconds:30}),
  tea:item('super_tonics',{type:'revive_ally'}),
};
const snap = (extra={}) => ({level:1,hp:20,sp:20,maxHp:100,maxSp:100,atk:1,matk:1,def:0,mdefPercent:0,accuracy:100,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,attackSpeed:1,moveSpeed:50,...extra});
const actor = (extra={}) => ({id:'hero',kind:'character',team:'a',position:{row:5,column:4},snapshot:snap(),inventory:{hp:5,sp:5,tonic:5},gambits:{lines:[{conditions:[{id:'always'}],action:{id:'use_item',itemId:'hp'}}]},...extra});
const enemy = {id:'foe',kind:'monster',team:'b',position:{row:5,column:5},snapshot:snap({hp:10000,maxHp:10000}),inventory:{},gambits:[]};
const replay = (hero,tick=20) => shared.replayBattleV2({version:2,seed:'timers',tickDurationMs:500,actors:[hero,enemy],definitions:{items,statuses:{haste_shot:{polarity:'buff'}}}},tick);
const use = replay(actor()).events.find(e=>e.action==='use_item');
assert.deepEqual(use.payload.cooldown,{key:'item:potion',durationTicks:20},'successful item use publishes authoritative category timer');
assert.equal(shared.consumableCooldownKey(items.hp,'hp'),shared.consumableCooldownKey(items.sp,'sp'));
assert.equal(shared.consumableCooldownKey(items.tonic,'tonic'),'item:tonic');
assert.equal(shared.consumableCooldownKey(items.tea,'tea'),'item:super_tonic');
for (const [locked, usedItem, blocked] of [['item:potion','sp',true],['item:potion','tonic',false],['item:tonic','hp',false],['item:super_tonic','tonic',false]]) {
  const probe=replay(actor({snapshot:snap({cooldowns:{[locked]:100}}),gambits:{lines:[{conditions:[{id:'always'}],action:{id:'use_item',itemId:usedItem}}]}}));
  assert.equal(probe.events.some(e=>e.action==='use_item'),!blocked,`${locked} ${blocked?'blocks':'does not block'} ${usedItem}`);
}
const caster=actor({snapshot:snap({skills:{bolt:true},skillDefs:{bolt:{spCost:0,baseCastTicks:4,cooldownTicks:8,ranged:true,effect:{type:'magic_damage'}}}}),gambits:{lines:[{conditions:[{id:'always'}],action:{id:'use_skill',skillId:'bolt'}}]}});
const castEvents=replay(caster,5).events;
assert.equal(castEvents.find(e=>e.action==='cast_start').payload.cooldown,undefined);
assert.deepEqual(castEvents.find(e=>e.action==='use_skill').payload.cooldown,{key:'skill:bolt',durationTicks:9});
const durations=shared.combatCooldownDurations({skillDefs:{bolt:{cooldownTicks:8},instant:{cooldownTicks:0}}},items);
assert.equal(durations['skill:bolt'],9);
assert.equal(durations['skill:instant'],undefined);
assert.equal(durations['item:super_tonic'],120);
console.log('combat-timers: shared categories, independence, authoritative starts and cast timing passed');
