const assert=require('node:assert/strict');
const {PartyService}=require('../dist/apps/api/src/modules/party/party.service');
const future=new Date(Date.now()+60000).toISOString(),past=new Date(Date.now()-1000).toISOString();
const character={id:'ally',hpCurrent:80,spCurrent:30,consumableCooldowns:{'item:potion':future,'item:tonic':past,hidden:future,'skill:bolt':future}};
const service=Object.create(PartyService.prototype);
service.member=async()=>({partyId:'party'});service.actions=async()=>[];service.shared={publicBattle:async()=>null};
service.battle={buildCharacterSnapshot:async()=>({maxHp:100,maxSp:50,skillDefs:{bolt:{cooldownTicks:8}}})};
service.db={getRepository:()=>({findOneBy:async()=>character}),query:async(sql)=>{
 if(sql.startsWith('SELECT * FROM parties'))return [{id:'party',revision:1}];
 if(sql.startsWith('SELECT m.*'))return [{characterId:'ally',name:'Ally',hpCurrent:80,spCurrent:30,statusEffects:[]}];
 return [];
}};
(async()=>{
 const view=await service.get('ally');
 assert.deepEqual(view.party.members[0].consumableCooldowns,{'item:potion':future,'skill:bolt':future},'only active, recognized timers may cross the Group boundary');
 assert.deepEqual(view.party.members[0].cooldownDurations,{'item:potion':20,'skill:bolt':9});
 console.log('party-timers-public: expired and unknown timers stay private');
})().catch(e=>{console.error(e);process.exitCode=1});
