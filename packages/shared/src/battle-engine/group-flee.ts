import { calculateFleeChancePercent } from '../world-activity';
import { Mulberry32 } from './prng';
export interface GroupEscapeActor {id:string;team:'a'|'b';hp:number;moveSpeed?:number;luk?:number;targetId?:string}
export interface GroupEscapeRoll {characterId:string;enemyId:string;chancePercent:number;rollPercent:number;success:boolean}
export interface GroupEscapeResult {allowed:boolean;success:boolean;rolls:GroupEscapeRoll[]}
export interface GroupFleeInput {seed:string;attempt:number;leaderId:string;actors:GroupEscapeActor[]}
function escapeRoll(input:GroupFleeInput,self:GroupEscapeActor,enemy:GroupEscapeActor,domain:string):GroupEscapeRoll {
  const chancePercent=calculateFleeChancePercent(self.moveSpeed??0,enemy.moveSpeed??0,self.luk??5);
  const rollPercent=new Mulberry32(`${input.seed}:${input.attempt}:${self.id}:${enemy.id}:${domain}`).nextPercent();
  return {characterId:self.id,enemyId:enemy.id,chancePercent,rollPercent,success:rollPercent<chancePercent};
}
/** Only living enemies currently targeting each member contribute rolls. */
export function evaluateGroupFlee(input:GroupFleeInput):GroupEscapeResult {
  const leader=input.actors.find(s=>s.id===input.leaderId);if(!leader||leader.hp<=0)return {allowed:false,success:false,rolls:[]};
  const sorted=[...input.actors].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);const rolls:GroupEscapeRoll[]=[];
  for(const self of sorted.filter(s=>s.team===leader.team&&s.hp>0))for(const enemy of sorted.filter(s=>s.team!==leader.team&&s.hp>0&&s.targetId===self.id))rolls.push(escapeRoll(input,self,enemy,'flee'));
  return {allowed:true,success:rolls.every(r=>r.success),rolls};
}
/** Outside Hunting every living member tests every aggressive generated enemy. */
export function evaluateGroupEncounterEvasion(input:GroupFleeInput&{aggressiveEnemyIds:string[]}):GroupEscapeResult {
  const leader=input.actors.find(s=>s.id===input.leaderId);if(!leader)return {allowed:false,success:false,rolls:[]};
  const sorted=[...input.actors].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);const rolls:GroupEscapeRoll[]=[];
  for(const self of sorted.filter(s=>s.team===leader.team&&s.hp>0))for(const enemy of sorted.filter(s=>s.team!==leader.team&&s.hp>0&&input.aggressiveEnemyIds.includes(s.id)))rolls.push(escapeRoll(input,self,enemy,'pre-combat-evasion'));
  return {allowed:true,success:rolls.every(r=>r.success),rolls};
}
