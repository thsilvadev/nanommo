import { Mulberry32 } from './prng';
export interface RaidCandidate {monsterId:string;chance:number}
export interface EncounterMonsterEntry {monsterId:string;raid?:{candidates:RaidCandidate[]}}
export interface EncounterMember {characterId:string;monsterId:string}
export interface ComposedEncounterMonster {id:string;monsterId:string;characterId:string;role:'principal'|'raid'}
/** Principal monsters have already been selected by each member's immutable encounter sequence. */
export function composeGroupEncounter(input:{seed:string;members:EncounterMember[];entries:EncounterMonsterEntry[];knownMonsterIds?:string[]}):ComposedEncounterMonster[] {
  if(input.members.length<1||input.members.length>5)throw new Error('Encounter requires 1 to 5 members');
  if(new Set(input.members.map(m=>m.characterId)).size!==input.members.length)throw new Error('Encounter member IDs must be unique');
  const known=input.knownMonsterIds?new Set(input.knownMonsterIds):undefined;
  for(const entry of input.entries) {
    const ids=new Set<string>();let sum=0;
    for(const c of entry.raid?.candidates??[]) {
      if(!Number.isFinite(c.chance)||c.chance<0||c.chance>100)throw new Error('Raid chance must be between 0 and 100');
      if(ids.has(c.monsterId))throw new Error('Raid candidate IDs must be unique');ids.add(c.monsterId);
      if(known&&!known.has(c.monsterId))throw new Error('Unknown raid monster ID');sum+=c.chance;
    }
    if(sum>100)throw new Error('Exclusive raid chances must sum to at most 100');
  }
  const result:ComposedEncounterMonster[]=[];
  for(const member of input.members) {
    if(known&&!known.has(member.monsterId))throw new Error('Unknown principal monster ID');
    result.push({id:`monster:${member.characterId}:principal`,monsterId:member.monsterId,characterId:member.characterId,role:'principal'});
    const entry=input.entries.find(e=>e.monsterId===member.monsterId);let roll=new Mulberry32(`${input.seed}:${member.characterId}:raid`).nextPercent();
    for(const c of entry?.raid?.candidates??[]) {if(roll<c.chance){result.push({id:`monster:${member.characterId}:raid`,monsterId:c.monsterId,characterId:member.characterId,role:'raid'});break;}roll-=c.chance;}
  }
  return result;
}
