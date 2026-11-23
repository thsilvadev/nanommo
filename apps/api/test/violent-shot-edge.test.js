const assert = require('node:assert/strict');
const shared = require('../../../packages/shared/dist');
const {simulateBattleV2Solo} = require('../../../packages/shared/dist/battle-engine/solo-adapter');
const catalogue = require('../../../skill_trees.json').trees.bow.find(s => s.id === 'violent_shot');
const statuses = Object.fromEntries(require('../../../status_effects.json').statusEffects.map(s => [s.id,s]));
const skill = {...catalogue, baseCastTicks:0, cooldownTicks:999, masteryRank:1};
const page = {lines:[{priority:1,conditions:[{id:'always'}],action:{id:'use_skill',params:{skillId:'violent_shot'}}}]};
const stats = {level:1,hp:1000,maxHp:1000,sp:500,maxSp:500,atk:25,matk:0,def:0,mdefPercent:0,accuracy:10000,evasion:0,critChance:0,agi:5,dex:5,luk:5,attackSpeed:0,moveSpeed:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,statusEffects:[]};
function input(selfColumn,targetColumn,{row=5,targetRow=row,blocker}={}) {
  const actors=[
    {id:'hero',name:'Archer',team:'a',kind:'character',position:{row,column:selfColumn},snapshot:{...stats,basicAttackRange:8,basicAttackDamageType:'ranged',skills:{violent_shot:1},skillDefs:{violent_shot:skill},masteryEquipment:[{slot:'mainHand',category:'bow',twoHanded:true}]},gambits:page,inventory:{}},
    {id:'foe',name:'Bandit',team:'b',kind:'monster',position:{row:targetRow,column:targetColumn},snapshot:{...stats},gambits:{lines:[]},inventory:{}},
  ];
  if(blocker!==undefined)actors.push({id:'blocker',name:'Ally',team:'a',kind:'character',position:{row:targetRow,column:blocker},snapshot:{...stats},gambits:{lines:[]},inventory:{}});
  return {version:2,elementalRulesVersion:1,seed:'violent-shot-edge',tickDurationMs:500,actors,definitions:{statuses}};
}
function execute(mode, battle) {
  if(mode==='group')return shared.replayBattleV2(battle,0);
  const hero=battle.actors[0].snapshot;
  return simulateBattleV2Solo(hero,{id:'foe',name:'Bandit',hp:1000,atk:0,atkSpeedTicks:99},page,battle.seed,{persistedInput:battle,stopAfterTick:0}).v2Result;
}
const cases=[
  {name:'full row to the right',self:0,target:1,end:9},
  {name:'full row to the left',self:9,target:8,end:0},
  {name:'attacker inside the row, right',self:3,target:4,end:9},
  {name:'attacker inside the row, left',self:6,target:5,end:0},
  {name:'already beyond old distance six',self:0,target:7,end:9},
  {name:'target already at the wall',self:0,target:9,end:9},
  {name:'another unit blocks the path',self:0,target:1,end:7,blocker:8},
  {name:'preserves target row even across different rows',self:0,target:1,end:9,row:0,targetRow:9},
];
for(const targetRow of [4,6])for(let column=0;column<10;column++) {
  cases.push({name:`same column ${column}, target row ${targetRow}`,self:column,target:column,end:column<5?0:9,row:5,targetRow});
}
cases.push({name:'same column left push respects blockers',self:4,target:4,end:3,row:5,targetRow:6,blocker:2});
cases.push({name:'same column right push respects blockers',self:5,target:5,end:6,row:5,targetRow:6,blocker:7});
const failures=[];
for(const mode of ['group','solo'])for(const c of cases) {
  try {
    const battle=input(c.self,c.target,c);
    const result=execute(mode,battle);
    const target=result.actorsAfter.foe;
    assert.equal(target.position.column,c.end,`${mode}: ${c.name}`);
    assert.equal(target.position.row,c.targetRow??c.row??5,'push never changes rows');
    const push=result.events.find(e=>e.action==='move'&&e.payload.reason==='push');
    if(c.target===c.end){assert(!push,'no fake movement at the wall');assert(!target.statusEffects.some(s=>s.type==='violent_shot_slow'),'no slow without displacement');}
    else {assert(push,'successful displacement is logged');assert.equal(push.actorId,'hero');assert.deepEqual(push.targetIds,['foe']);assert.equal(push.payload.from.column,c.target);assert.equal(push.payload.to.column,c.end);assert(target.statusEffects.some(s=>s.type==='violent_shot_slow'),'successful push retains its slow');}
    if(c.self===0&&c.end===9)assert.equal(Math.abs(target.position.column-c.self)-1,8,'opposite ends have eight empty slots');
    assert.deepEqual(execute(mode,battle),result,'replay stays deterministic');
  }catch(error){failures.push(error);console.error(error.message)}
}
// Persisted V2 inputs keep the old skill definition and must replay with its original reach.
for(const mode of ['group','solo']) {
  const frozen=input(0,1);
  const {pushToRowEnd,sameColumnPushToNearestEdge:oldTieRule,...oldEffect}=skill.effect;
  frozen.actors[0].snapshot.skillDefs.violent_shot={...skill,effect:{...oldEffect,targetDistance:6}};
  assert.equal(execute(mode,frozen).actorsAfter.foe.position.column,7,'old persisted skill definitions keep their original six-space push');
  const sameColumn=input(4,4,{row:5,targetRow:6});
  sameColumn.actors[0].snapshot.skillDefs.violent_shot={...skill,effect:{...oldEffect,targetDistance:6}};
  assert.equal(execute(mode,sameColumn).actorsAfter.foe.position.column,9,'old frozen definitions preserve their same-column direction');
  const previousRowEnd=input(4,4,{row:5,targetRow:6});
  const {sameColumnPushToNearestEdge,...previousEffect}=skill.effect;
  previousRowEnd.actors[0].snapshot.skillDefs.violent_shot={...skill,effect:previousEffect};
  assert.equal(execute(mode,previousRowEnd).actorsAfter.foe.position.column,9,'previous row-end snapshots keep their original rightward tie break');
}
assert.equal(catalogue.effect.targetDistance,8,'catalogue records the maximum empty-space distance');
assert.equal(failures.length,0,'all edge-push cases must pass');
console.log(`violent-shot-edge: ${cases.length*2} solo/group scenarios, walls, same-column ties, blockers, row preservation, slow and deterministic replay passed`);
