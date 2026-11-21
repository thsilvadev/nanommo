const assert=require('node:assert/strict');
const {CharacterService}=require('../dist/apps/api/src/modules/character/character.service');
const {BattleService}=require('../dist/apps/api/src/modules/battle/battle.service');
const items=require('../../../items.json').equipment;
const earth=items.find(item=>item.id.startsWith('equip_shoes_earth_'));
const boots={slot:'shoes',itemId:earth.id,instanceData:{elementalImmunity:'fire'}};
const c={id:'hero',name:'Hero',level:1,str:5,agi:5,dex:5,vit:5,int:5,luk:5,hpCurrent:100,spCurrent:100,diet:[],dietLevels:{},statusEffects:[],activeTempBuffs:[]};
(async()=>{
 const service=Object.create(CharacterService.prototype);
 service.equippedItemRepository={find:async()=>[boots]};service.dataService={getItemById:()=>earth,getXpToNextLevel:()=>100};
 service.buildEquipmentStats=()=>({});service.buildTotalAttributeBonuses=async()=>({});service.getFoodRegenAt=()=>({count:0,expiresAt:0});
 const dto=await service.toDto(c);assert.equal(dto.elementalAffinity,'earth');assert.deepEqual(dto.elementalResistances,{earth:50,water:0,fire:-50,wind:25,holy:0,shadow:0});
 const battle=Object.create(BattleService.prototype);
 const loadout={equipmentStats:{statBonus:{}},skills:{},skillDefs:{},weaponTypes:['sword','dagger'],masteryEquipment:[],movementEquipment:[{...boots,definition:earth},{slot:'mainHand',definition:{weaponType:'sword',fixedStats:{atk:100}},instanceData:{enchantedElement:'fire'}},{slot:'offHand',definition:{weaponType:'dagger',fixedStats:{atk:40}},instanceData:{enchantedElement:'water'}}]};
 const snapshot=await battle.buildCharacterSnapshot(c,100,100,Date.now(),[],loadout,{});
 assert.equal(snapshot.element,'earth');assert.equal(snapshot.elementalRulesVersion,1);assert.equal(snapshot.basicAttackElement,'fire');assert.deepEqual(snapshot.basicAttackElements,[{slot:'mainHand',element:'fire',attack:100},{slot:'offHand',element:'water',attack:20}]);
 console.log('elemental character projection: authoritative DTO, legacy owned boots, defensive affinity and per-hand enchanted snapshots passed');
})().catch(error=>{console.error(error);process.exitCode=1});
