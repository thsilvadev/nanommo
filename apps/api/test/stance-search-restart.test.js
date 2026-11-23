const assert = require('node:assert/strict');
const { EncounterClockService } = require('../dist/apps/api/src/modules/battle/encounter-clock.service');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service');
const { MapService } = require('../dist/apps/api/src/modules/map/map.service');
const { Character, BattleQueueEntry } = require('../dist/apps/api/src/database/entities');
function database() {
  let row = null;
  let transactions = 0;
  const manager = { query: async (sql, args = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.startsWith('SELECT')) return row && row.ownerId === args[0] ? [structuredClone(row)] : [];
    if (sql.startsWith('INSERT INTO encounter_clocks')) {
      row = { ownerKind: 'character', ownerId: args[0], mapId: args[1], cycle: Number(row?.cycle ?? -1) + 1, searchStartedAt: args[2], dueAt: args[3], seed: args[4], roster: JSON.parse(args[5]), status: 'searching', generation: Number(row?.generation ?? 0) + 1 };
      return [structuredClone(row)];
    }
    if (sql.includes("SET status='consumed'")) {
      if (row?.status === 'searching' && row.ownerId === args[0] && row.seed === args[1] && new Date(row.dueAt).getTime() === new Date(args[2]).getTime()) { row.status = 'consumed'; return [{ ownerId: row.ownerId }]; }
      return [];
    }
    if (sql.includes("SET status='cancelled'")) {
      if(row?.status==='searching' && row.ownerId===args[0]) { row.status='cancelled'; return [{ownerId:row.ownerId}]; }
      return [];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const db = { manager, transaction: async fn => { transactions++; return fn(manager); } };
  return { db, manager, row: () => structuredClone(row), transactions: () => transactions };
}

async function scenario(previousStance, active=false, nextStance='hunting') {
  const integrationDb = database();
  const integrated = Object.create(BattleService.prototype);
  const queue = [];
  let serial = 0;
  const now = Date.now();
  const food = { itemId: 'food_bread', hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, expiresAt: new Date(now + 3600000).toISOString() };
  const character = { id: 'actor-1', currentMapId: 'map-test', status: 'grinding', hpCurrent: 1000, spCurrent: 1000, level: 1, str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5, statusEffects: [], activeFoodBuff: food, diet: [], dietLevels: {}, activeGambitPageId: 'page-1', lastGrindStance: previousStance, encounterCycle: {}, gatheringCycle: { progress: 0, lastUpdatedAt: new Date(0).toISOString() } };
  const monster = { id: 'mon_slime', name: 'Slime', level: 1, hp: 10, atk: 1, matk: 0, def: 0, mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 99, moveSpd: 0, isAggressive: false, xpReward: 1, drops: [], gambit: [], damageTakenMultiplier: { melee: 1, ranged: 1, magic: 1 }, weight: 100 };
  const actorSnapshot = { level: 1, hp: 1000, sp: 1000, maxHp: 1000, maxSp: 1000, atk: 1000, matk: 0, def: 0, mdefPercent: 0, accuracy: 1000, evasion: 0, critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5, luk: 5, attackSpeed: 100, castTimeReduction: 10, equippedWeaponTypes: [], skills: {}, skillDefs: {}, statusEffects: [], basicAttackRange: 0, basicAttackDamageType: 'melee', combatStyle: 'melee', moveSpeedBase: 50, foodBuffs: [{ itemId: 'food_bread', hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, remainingTicks: 180 }], foodBuffTicksRemaining: 180 };
  integrated.encounterClocks = new EncounterClockService(integrationDb.db);

  integrated.characterRepo = { findOne: async () => character, save: async value => value };
  integrated.battleQueueRepo = { create: value => value, save: async value => { const saved = { id: `battle-${++serial}`, ...value }; queue.push(saved); return saved; } };
  integrated.gambitPageRepo = { findOne: async () => ({ lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }] }) };
  integrated.getBattleQueue = async () => [...queue];
  integrated.discardUnresolvedBattles = async (_id, keepId) => { const keep = queue.filter(row => row.id === keepId); queue.splice(0, queue.length, ...keep); };
  integrated.mapPresenceService = { countActiveGrinders: async () => 1 };
  integrated.equipmentService = { getEquipment: async () => [] };
  integrated.loadCombatantLoadout = async () => ({ weaponTypes: [], equipmentStats: { statBonus: {} }, skillDefs: {}, skills: {} });
  integrated.buildCharacterSnapshot = async () => structuredClone(actorSnapshot);
  integrated.buildAuthoritativeBattleSnapshot = async () => ({});
  integrated.buildInventoryMap = async () => ({});
  integrated.getOrCreateKillCounter = async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} });
  integrated.getActiveDietFoodBuffs = () => [food];
  integrated.dataService = { getMapById: id => ({ id, type: 'grind' }), getMonstersInMap: () => [monster], getMonsterById: () => monster, getMonsterSkills: () => [], getStatusEffects: () => [], getItems: () => ({}), getItemById: () => null, getGlobalItemDrops: () => ({ drops: [] }), getWeaponBaseAttackTicks: () => 6 };
  integrated.bullQueue = { add: async () => {} };
  integrated.safePublishQueueUpdated = async () => {};
  integrated.logger = { log() {}, warn() {}, debug() {} };


  const future={id:'gathering-projection',characterId:character.id,mapId:character.currentMapId,monsterId:monster.id,seedUsed:'gathering-seed',sequenceIndex:0,startAt:new Date(now+600000),endAt:new Date(now+610000),log:{searchStartAt:new Date(now).toISOString()}};
  await integrated.encounterClocks.reserveProjection(future);
  queue.push(future);
  if(active) {
    const current={...future,id:'active',startAt:new Date(now-1000),endAt:new Date(now+10000)};
    await integrated.encounterClocks.consumeProjection(future);
    await integrated.encounterClocks.reserveProjection(current);
    queue.unshift(current);
  }
  const jobs=[];
  integrated.bullQueue={add:async(name,data,options)=>jobs.push({name,data,options})};
  integrated.withCharacterQueueLock=async(_id,fn)=>fn();
  integrated.removeBattleQueueJobs=async()=>{};
  integrated.publishQueueUpdated=async()=>{};
  const repo=integrated.characterRepo;
  const queueRepo={find:async()=>[...queue],delete:async(options)=>{const ids=options.id._value;for(let i=queue.length-1;i>=0;i--)if(ids.includes(queue[i].id))queue.splice(i,1)}};
  const manager={...integrationDb.manager,getRepository:entity=>entity===Character?repo:entity===BattleQueueEntry?queueRepo:null};
  repo.manager={transaction:async fn=>fn(manager)};
  const maps=Object.create(MapService.prototype);
  Object.assign(maps,{characterRepo:repo,dataService:integrated.dataService,battleService:integrated,scheduleStationaryActivity:async()=>{}});
  await maps.setStance(character.id,nextStance);
  assert.equal(character.lastGrindStance,nextStance);
  if(active) {
    assert.equal(queue.length,1);assert.equal(queue[0].id,'active','a started encounter stays immutable');
    assert.equal(new Date(integrationDb.row().dueAt).getTime(),queue[0].startAt.getTime(),'active encounter reservation untouched');
  } else if(nextStance==='gathering') {
    assert.equal(queue.length,0,'passive candidates are avoided in Gathering');
    const journals=jobs.filter(job=>job.name==='idle-journal-precombat');
    assert(journals.length>0,'avoided candidates must publish System journal jobs');
    const first=journals[0];
    assert(first.options.delay>=0&&first.options.delay<10000,'first Gathering log follows a normal search, not the old future reservation');
    const {BattleQueueProcessor}=require('../dist/apps/api/src/modules/battle/battle-queue.processor');
    const worker=Object.create(BattleQueueProcessor.prototype);
    const published=[];
    const {IdleJournalService}=require('../dist/apps/api/src/modules/chat/chat-history.service');
    const journal=new IdleJournalService({claimJournalKey:async()=>true,appendJournal:async(id,row)=>published.push({id,row})});
    Object.assign(worker,{queueGate:{assertReadyForProcessing:async()=>{}},characterService:{getCharacterById:async()=>character},idleJournal:journal,logger:integrated.logger});
    await worker.publishPreCombatJournal({data:first.data});
    assert.equal(published.length,1,'due Gathering job reaches the System journal');
    await worker.publishPreCombatJournal({data:{...first.data,aggressive:true,monsterName:'Mudcrawler'}});
    assert.equal(published.length,2,'successful pre-combat dodge reaches the System journal');
    assert.equal(published[0].id,character.id);
    assert.equal(published[0].row.message,'You passed by a Slime and moved on.');
    assert.equal(published[1].row.message,'Mudcrawler found you, but you misled it!');
    assert.equal(published[1].row.channel,'journal');
    character.lastGrindStance='hunting';
    await worker.publishPreCombatJournal({data:first.data});
    assert.equal(published.length,2,'old Gathering journal is suppressed after switching to Hunting');
  } else if(previousStance==='hunting') {
    assert.equal(queue[0].startAt.getTime(),future.startAt.getTime(),'same stance cannot reset an existing search');
    assert.equal(queue[0].seedUsed,'gathering-seed');
  } else {
    assert(queue.length>0,'Hunting must schedule fights without moving');
    const delay=queue[0].startAt.getTime()-now;
    assert(delay>=3000&&delay<10000,`Hunting must use a fresh normal search, not inherit the Gathering projection (${delay}ms)`);
    assert.equal(new Date(integrationDb.row().dueAt).getTime(),queue[0].startAt.getTime(),'reservation follows replacement search');
    assert(jobs.some(job=>job.name==='resolve-battle'),'replacement fight has a resolver');
  }
}
(async()=>{await scenario('gathering');await scenario('hunting');await scenario('gathering',true);await scenario('hunting',false,'gathering');console.log('stance-search-restart: fresh Hunting search, no-op stability and immutable active fight and Gathering System events passed')})().catch(error=>{console.error(error);process.exitCode=1});
