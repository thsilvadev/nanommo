import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { BattleHistoryEntry, BattleLogDetail } from '../../core/game.models';
import { CharacterStore } from '../../core/game.store';

@Component({selector:'app-battle-logs',standalone:true,imports:[CommonModule],templateUrl:'./battle-logs.component.html',styleUrl:'./battle-logs.component.css'})
export class BattleLogsComponent {
  private readonly api=inject(ApiService);
  private readonly character=inject(CharacterStore);
  readonly battles=signal<BattleHistoryEntry[]>([]);
  readonly selected=signal<BattleLogDetail|null>(null);
  readonly loading=signal(true); readonly detailLoading=signal(false);
  readonly error=signal<string|null>(null); readonly detailError=signal<string|null>(null);

  constructor(){void this.load();}
  async load(){this.loading.set(true);this.error.set(null);try{this.battles.set(await this.api.get<BattleHistoryEntry[]>('/battles/history').toPromise()??[]);}catch{this.error.set('Unable to load battle logs.');}finally{this.loading.set(false);}}
  async openBattle(battle:BattleHistoryEntry){this.selected.set(null);this.detailError.set(null);this.detailLoading.set(true);try{this.selected.set(await this.api.get<BattleLogDetail>('/battles/'+battle.id).toPromise()??null);}catch{this.detailError.set('Unable to load this battle log.');}finally{this.detailLoading.set(false);}}
  close(){this.selected.set(null);this.detailError.set(null);}
  formatDate(value:string){return new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});}
  formatDuration(start:string,end:string){const seconds=Math.max(0,Math.round((Date.parse(end)-Date.parse(start))/1000));return seconds<60?seconds+'s':Math.floor(seconds/60)+'m '+seconds%60+'s';}
  displayEvents(battle:BattleLogDetail){return (battle.log?.events??[]).filter((event:any)=>event?.action!=='range_blocked');}
  eventText(event:any){
    const log:any=this.selected()?.log;
    const playerName=String(log?.header?.characterSnapshot?.characterName??this.character.character()?.name??'Character');
    const monsterName=String(this.selected()?.monsterName??'Enemy');
    const actor=event?.actor==='character'?playerName:event?.actor==='monster'?monsterName:String(event?.actor??'Unknown');
    if(event?.action==='move'){
      const spaces=Number(event.spacesMoved??Math.abs(Number(event.toPosition??0)-Number(event.fromPosition??0)));
      const fromPosition=Number(event?.fromPosition);
      const toPosition=Number(event?.toPosition);
      const hasPositionDelta=event?.fromPosition!=null&&event?.toPosition!=null&&Number.isFinite(fromPosition)&&Number.isFinite(toPosition)&&fromPosition!==toPosition;
      const arrow=hasPositionDelta?(toPosition>fromPosition?'-->':'<--'):(event?.direction==='right'||event?.direction===1||event?.direction==='1')?'-->':(event?.direction==='left'||event?.direction===-1||event?.direction==='-1')?'<--':'';
      return actor+' moved ( '+spaces+' ) '+arrow;
    }
    const status=String(event?.status??'status').replace(/_/g,' ').toLowerCase();
    const target=event?.target==='character'?playerName:event?.target==='monster'?monsterName:actor;
    if(event?.action==='status_damage') return target+' takes '+Number(event.damage??0)+' pure '+status+' damage.';
    if(event?.action==='freeze_applied') return target+' is freezing ('+Number(event.stackCount??1)+')';
    if(event?.action==='status_stack_applied') return target+' gains '+status+' from '+actor+' ('+Number(event.stackCount??1)+')';
    if(event?.action==='status_stack_lessened') return target+"'s "+status+' lessens ('+Number(event.remainingStacks??event.stackCount??0)+')';
    if(event?.action==='status_ended'||event?.action==='status_expired') return target+"'s "+status+' ended';
    if(event?.action==='status_applied'||event?.action==='status_refreshed') return actor+' applies '+status+' to '+target;
    if(event?.action==='regen') return actor+' regenerated +'+Number(event.amount??0)+' '+String(event.resource??'HP')+'.';
    if(event?.action==='sp_regen') return actor+' regenerated +'+Number(event.amount??0)+' SP.';
    if(event?.action==='attack') return actor+' attack'+(event.crit?' — CRITICAL HIT':'')+(event.damage!=null?' for '+event.damage+' damage':'')+'.';
    if(event?.action==='use_skill'){
      const skill=event.skillId==='monster_skill_ice_bolt'?'Ice Bolt':String(event.skillId??'a skill').replace(/_/g,' ');
      return actor+' used '+skill+(event.damage!=null?' for '+event.damage+' damage':'')+(event.healAmount!=null?' and healed '+event.healAmount+' HP':'')+'.';
    }
    if(event?.action==='use_item') return actor+' used '+String(event.itemId??'an item').replace(/_/g,' ')+(event.healAmount!=null?' and restored '+event.healAmount+' HP':'')+'.';
    if(event?.healAmount!=null) return actor+' healed for '+event.healAmount+' HP.';
    return actor+' '+String(event?.action??'action').replace(/_/g,' ')+'.';
  }
}
