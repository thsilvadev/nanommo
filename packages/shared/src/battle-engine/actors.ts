import type { BattleActor, BattleActorState, CombatSkillDefinition } from '../types/group-battle';
import { GambitEvaluator } from './index';
import { activeGambitLines } from './active-gambits';
import { gridKey } from './grid';
export const stableActorOrder = (a:{id:string;orderIndex?:number},b:{id:string;orderIndex?:number}):number => (a.orderIndex??0)-(b.orderIndex??0) || (a.id<b.id?-1:a.id>b.id?1:0);
export function firstHostileStyle(actor:BattleActor):'melee'|'ranged' {
  const snapshot={...actor.snapshot};
  const page=GambitEvaluator.normalizeGambitPage(activeGambitLines(actor.gambits));
  for(const line of [...page.lines].sort((a,b)=>(a.priority??0)-(b.priority??0))) {
    if(!GambitEvaluator.isActionLegal(line.action,snapshot,actor.inventory)) continue;
    if(line.action.id==='attack') return snapshot.basicAttackDamageType==='ranged'||Number(snapshot.basicAttackRange??0)>0||snapshot.combatStyle==='ranged'?'ranged':'melee';
    const skill:CombatSkillDefinition=snapshot.skillDefs?.[line.action.params?.skillId??line.action.skillId];
    if(line.action.id==='use_skill'&&skill&&(!skill.target||skill.target==='foe')) return skill.ranged?'ranged':'melee';
  }
  return 'ranged';
}
/** Rows a team of N principals deploys on (also the battle arena's walking formation). */
export const CENTRAL_DEPLOYMENT_ROWS:Readonly<Record<number,readonly number[]>>={1:[5],2:[4,5],3:[4,5,6],4:[3,4,5,6],5:[3,4,5,6,7]};
/** Roster order controls central rows; identities remain independent of display names. */
export function placeBattleActors(actors:BattleActor[]):BattleActor[] {
  const out=actors.map(a=>({...a,position:{...a.position}}));
  const teams=['a','b'].map(team=>out.filter(a=>a.team===team).sort(stableActorOrder));
  if(teams.some(t=>t.length>10)) throw new Error('At most 10 actors per team');
  const rows=CENTRAL_DEPLOYMENT_ROWS;
  const occupied=new Set<string>();
  const nearestRow=(anchor:number,column:number):number=>{
    const candidates=[anchor,...Array.from({length:10},(_,d)=>[anchor-d-1,anchor+d+1]).flat()];
    const row=candidates.find(r=>r>=0&&r<10&&!occupied.has(gridKey({row:r,column})));
    if(row===undefined)throw new Error('No free deployment row');return row;
  };
  const deploy=(actor:BattleActor,row:number,column:number)=>{
    actor.position={row:nearestRow(row,column),column};occupied.add(gridKey(actor.position));
  };
  for(let side=0;side<2;side++) {
    const own=teams[side],other=teams[1-side];
    const principals=own.filter(a=>a.encounterRole!=='raid');
    const extras=own.filter(a=>a.encounterRole==='raid');
    principals.forEach((actor,i)=>{
      const opponent=actor.principalActorId?other.find(a=>a.id===actor.principalActorId):other.filter(a=>a.encounterRole!=='raid')[i];
      const bothMelee=firstHostileStyle(actor)==='melee'&&opponent&&firstHostileStyle(opponent)==='melee';
      const column=bothMelee?(side===0?4:5):(side===0?0:9);
      const centralRows=rows[Math.min(5,principals.length)];
      const row=side===1&&opponent?opponent.position.row:i<5?centralRows[i]:5;
      deploy(actor,row,i>=5?(side===0?0:9):column);
    });
    for(const actor of extras) {
      const opponent=other.find(a=>a.id===actor.principalActorId);
      deploy(actor,opponent?.position.row??5,side===0?0:9);
    }
  }
  return out;
}
export function createActorStates(actors:BattleActor[]):Record<string,BattleActorState> {
  const states:Record<string,BattleActorState>={};const counts=new Map<string,number>();
  for(const a of actors) if(a.kind==='monster') counts.set(a.name??a.definitionId??a.id,(counts.get(a.name??a.definitionId??a.id)??0)+1);
  const indexes=new Map<string,number>();
  for(const a of actors) {
    const key=a.name??a.definitionId??a.id; const index=(indexes.get(key)??0)+1;indexes.set(key,index);
    const s=JSON.parse(JSON.stringify(a.snapshot)) as BattleActorState;
    states[a.id]={...s,id:a.id,name:a.kind==='monster'&&(counts.get(key)??0)>1?`${key} ${index}`:key,kind:a.kind,team:a.team,position:{...a.position},inventory:{...a.inventory},statusEffects:s.statusEffects??[],cooldowns:s.cooldowns??{},foodBuffs:s.foodBuffs??(s.foodBuffTicksRemaining&&s.foodBuffItemId?[{itemId:s.foodBuffItemId,hpRegenPerTenTicks:s.foodBuffHpRegenPerTenTicks??0,spRegenPerTenTicks:s.foodBuffSpRegenPerTenTicks??0,remainingTicks:s.foodBuffTicksRemaining}]:[]),foodDigestRemainingTicksByItem:s.foodDigestRemainingTicksByItem??{},dietLevelByFood:s.dietLevelByFood??{},attackGauge:0,castGauge:0,movementGauge:s.movementGauge??0,pendingCast:null,itemsConsumed:[],hp:Math.max(0,Math.min(s.maxHp,s.hp)),sp:Math.max(0,Math.min(s.maxSp,s.sp))};
  }
  return states;
}
