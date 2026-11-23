const assert = require('node:assert/strict');
const {BattleService}=require('../dist/apps/api/src/modules/battle/battle.service');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
const {InventoryItem,GambitPage,MapKillCounter}=require('../dist/apps/api/src/database/entities');

async function solo(weapon, rangedSkill=false) {
  const integrated = Object.create(BattleService.prototype);
  const queue = [];
  let serial = 0;
  const now = Date.now();
  const food = { itemId: 'food_bread', hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, expiresAt: new Date(now + 3600000).toISOString() };
  const character = { id: 'actor-1', currentMapId: 'map-test', status: 'grinding', hpCurrent: 1000, spCurrent: 1000, level: 1, str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5, statusEffects: [], activeFoodBuff: food, diet: [], dietLevels: {}, activeGambitPageId: 'page-1', lastGrindStance: 'hunting', encounterCycle: {}, gatheringCycle: { progress: 0, lastUpdatedAt: new Date(0).toISOString() } };
  const monster = { id: 'mon_slime', name: 'Slime', level: 1, hp: 10, atk: 1, matk: 1000, def: 0, mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 99, moveSpd: 0, isAggressive: false, xpReward: 1, drops: [], gambit: [], damageTakenMultiplier: { melee: 1, ranged: 1, magic: 1 }, weight: 100 };
  const actorSnapshot = { level: 1, hp: 1000, sp: 1000, maxHp: 1000, maxSp: 1000, atk: 1000, matk: 1000, def: 0, mdefPercent: 0, accuracy: 1000, evasion: 0, critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5, luk: 5, attackSpeed: 100, castTimeReduction: 10, equippedWeaponTypes: [], skills: {}, skillDefs: {}, statusEffects: [], basicAttackRange: 0, basicAttackDamageType: 'melee', combatStyle: 'melee', moveSpeedBase: 50, foodBuffs: [{ itemId: 'food_bread', hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, remainingTicks: 180 }], foodBuffTicksRemaining: 180 };

  integrated.characterRepo = { findOne: async () => character, save: async value => value };
  integrated.battleQueueRepo = { create: value => value, save: async value => { const saved = { id: `battle-${++serial}`, ...value }; queue.push(saved); return saved; } };
  integrated.gambitPageRepo = { findOne: async () => ({ lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }, ...(rangedSkill ? [{priority:2,conditions:[{id:'always'}],action:{id:'use_skill',params:{skillId:'ranged_spell'}}}] : [])] }) };
  integrated.getBattleQueue = async () => [...queue];
  integrated.discardUnresolvedBattles = async (_id, keepId) => { const keep = queue.filter(row => row.id === keepId); queue.splice(0, queue.length, ...keep); };
  integrated.mapPresenceService = { countActiveGrinders: async () => 1 };
  integrated.equipmentService = { getEquipment: async () => [] };
  integrated.loadCombatantLoadout = async () => ({ weaponTypes: [weapon], equipmentStats: { statBonus: {} }, skillDefs: { ranged_spell: {id:'ranged_spell',ranged:true,maxRange:8} }, skills: {ranged_spell:1} });
  integrated.buildCharacterSnapshot = async () => structuredClone(actorSnapshot);
  integrated.buildAuthoritativeBattleSnapshot = async () => ({});
  integrated.buildInventoryMap = async () => ({});
  integrated.getOrCreateKillCounter = async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} });
  integrated.getActiveDietFoodBuffs = () => [food];
  integrated.dataService = { getMapById: id => ({ id, type: 'grind' }), getMonstersInMap: () => [monster], getMonsterById: () => monster, getMonsterSkills: () => [], getStatusEffects: () => [], getItems: () => ({}), getItemById: () => null, getGlobalItemDrops: () => ({ drops: [] }), getWeaponBaseAttackTicks: () => 6 };
  integrated.bullQueue = { add: async () => {} };
  integrated.safePublishQueueUpdated = async () => {};
  integrated.logger = { log() {}, warn() {}, debug() {} };



  await integrated.queueBattlesLocked(character.id,1,false);
  assert.equal(queue.length,1);
  return queue[0].startingSnapshot.snapshot;
}
async function shared(weapon) {
  const snapshot=await solo(weapon);
  // The shared path must establish its own profile rather than inherit solo's override.
  delete snapshot.basicAttackRange;delete snapshot.basicAttackDamageType;
  snapshot.equippedWeaponTypes=[weapon];
  const monster={id:'mon_slime',name:'Slime',level:1,hp:10,atk:1,matk:0,def:0,mdefPercent:0,accuracy:0,evasion:0,critChance:0,atkSpeedTicks:99,moveSpd:0,isAggressive:false,xpReward:1,drops:[],gambit:[],damageTakenMultiplier:{melee:1,ranged:1,magic:1},weight:100};
  const actor={id:'actor-1',name:'Hero',hpCurrent:1000,spCurrent:1000,lastGrindStance:'hunting',activeGambitPageId:'page-1'};
  let persisted;
  const manager={getRepository(entity){
    if(entity===InventoryItem)return {findBy:async()=>[]};
    if(entity===GambitPage)return {findOneBy:async()=>({lines:[{priority:1,conditions:[{id:'always'}],action:{id:'attack'}}]})};
    if(entity===MapKillCounter)return {findOneBy:async()=>({epoch:0,mapKillCount:0})};
    throw Error('Unexpected repository');
  },query:async(sql,args)=>{if(sql.startsWith('INSERT INTO shared_battles'))persisted=JSON.parse(args[6]);return []}};
  const service=Object.create(SharedBattleService.prototype);
  Object.assign(service,{battle:{buildCharacterSnapshot:async()=>structuredClone(snapshot)},data:{getMonstersInMap:()=>[monster],getMonsterById:()=>monster,getMapById:()=>({monsters:[]}),getItems:()=>({}),getMonsterSkills:()=>[],getStatusEffects:()=>[]}});
  const ctx={party:{id:'party',mapId:'map-test',leaderCharacterId:actor.id},characters:[actor],members:[{characterId:actor.id,orderIndex:0}],manager};
  await service.start(ctx,{dueAt:new Date(),seed:'bow-only-regression'});
  assert(persisted,'shared snapshot persisted');
  return persisted.actors.find(a=>a.id===actor.id).snapshot;
}
(async()=>{
  const failures=[];
  for(const weapon of ['staff','rod','sword','bow'])for(const [name,run]of [['solo',solo],['group',shared]]){
    try{const snapshot=await run(weapon);assert.equal(snapshot.basicAttackRange,weapon==='bow'?8:0,`${name} ${weapon}: only bow attacks across 8 empty slots`);if(name==='solo')assert.equal(snapshot.combatStyle,weapon==='bow'?'ranged':'melee',`${weapon} basic attack alone must not classify the actor as ranged`)}catch(error){failures.push(error);console.error(error.message)}
  }
  for(const weapon of ['staff','rod']){
    const snapshot=await solo(weapon,true);
    assert.equal(snapshot.basicAttackRange,0,'a ranged skill never extends the basic attack range');
    assert.equal(snapshot.combatStyle,'ranged','available ranged Gambit skills still affect entry style');
  }
  assert.equal(failures.length,0,'all solo/group basic attack profiles must agree');
  console.log('weapon-basic-range: bow 8, staff/rod/sword adjacent, ranged skills independent in solo/group passed');
})().catch(error=>{console.error(error);process.exitCode=1});
