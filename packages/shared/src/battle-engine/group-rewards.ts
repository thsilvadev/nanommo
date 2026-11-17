import { Mulberry32 } from './prng';
import type { ResolvedDrop } from './rewards';
export interface GroupRewardParticipant { characterId:string;alive:boolean;orderIndex?:number;inventoryFreeUnits?:number }
export interface GroupRewardMonster { id:string;monsterId:string;killed:boolean;xp:number;drops:ResolvedDrop[] }
export interface GroupQuestDrop { id:string;monsterId:string;itemId:string;chancePercent:number;quantity:number;eligible:Array<{characterId:string;questInstanceId:string}> }
export interface GroupActorRewards { xpGain:number;goldGain:0;drops:ResolvedDrop[];questDrops:Array<{itemId:string;quantity:number;questInstanceId:string;objectiveId:string}>;killedMonsterIds:string[] }
/** One common drop roll is supplied per killed monster; ownership is rolled once per unit. */
export function allocateGroupRewards(input:{seed:string;outcome:'win'|'loss'|'fled';participants:GroupRewardParticipant[];monsters:GroupRewardMonster[];questDrops?:GroupQuestDrop[]}):Record<string,GroupActorRewards> {
  const sorted=[...input.participants].sort((a,b)=>(a.orderIndex??0)-(b.orderIndex??0)||(a.characterId<b.characterId?-1:a.characterId>b.characterId?1:0));
  if(new Set(sorted.map(p=>p.characterId)).size!==sorted.length)throw new Error('Reward participant IDs must be unique');
  const out:Record<string,GroupActorRewards>=Object.fromEntries(sorted.map(p=>[p.characterId,{xpGain:0,goldGain:0,drops:[],questDrops:[],killedMonsterIds:[]}]));
  const eligible=sorted.filter(p=>p.alive);if(input.outcome!=='win'||!eligible.length)return out;
  const free=new Map(eligible.map(p=>[p.characterId,p.inventoryFreeUnits??Infinity]));
  const killed=input.monsters.filter(m=>m.killed).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const total=killed.reduce((n,m)=>n+Math.max(0,Math.floor(m.xp)),0);const base=Math.floor(total/eligible.length);const rest=total%eligible.length;
  eligible.forEach((p,i)=>{out[p.characterId].xpGain=base+(i<rest?1:0);out[p.characterId].killedMonsterIds=killed.map(m=>m.monsterId);});
  for(const monster of killed) monster.drops.forEach((drop,dropIndex)=>{
    for(let unit=0;unit<Math.max(0,Math.floor(drop.quantity));unit++) {
      const recipient=eligible[new Mulberry32(`${input.seed}:${monster.id}:drop:${dropIndex}:unit:${unit}:recipient`).nextInt(0,eligible.length)];
      // A full inventory discards its winning unit rather than rerolling another recipient.
      const remaining=free.get(recipient.characterId)!;if(remaining<=0)continue;free.set(recipient.characterId,remaining-1);
      out[recipient.characterId].drops.push({...drop,quantity:1});
    }
  });
  for(const quest of [...input.questDrops??[]].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)) {
    if(!Number.isFinite(quest.chancePercent)||quest.chancePercent<0||quest.chancePercent>100)throw new Error('Quest drop chance must be between 0 and 100');
    for(const monster of killed.filter(m=>m.monsterId===quest.monsterId)) {
      if(!new Mulberry32(`${input.seed}:${monster.id}:quest:${quest.id}`).chance(quest.chancePercent/100))continue;
      for(const member of quest.eligible) if(eligible.some(p=>p.characterId===member.characterId))out[member.characterId].questDrops.push({itemId:quest.itemId,quantity:Math.max(0,Math.floor(quest.quantity)),questInstanceId:member.questInstanceId,objectiveId:quest.id});
    }
  }
  return out;
}
