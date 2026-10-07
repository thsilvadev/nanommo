import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { BattleHistoryEntry, BattleLogDetail } from '../../core/game.models';

@Component({selector:'app-battle-logs',standalone:true,imports:[CommonModule],templateUrl:'./battle-logs.component.html',styleUrl:'./battle-logs.component.css'})
export class BattleLogsComponent {
  private readonly api=inject(ApiService);
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
  eventText(event:any){
    const actor=event?.actor==='character'?'You':event?.actor==='monster'?(this.selected()?.monsterName??'Enemy'):String(event?.actor??'Unknown');
    const action=String(event?.action??'action').replace(/_/g,' ');
    if(event?.action==='attack') return actor+' '+action+(event.crit?' — CRITICAL HIT':'')+(event.damage!=null?' for '+event.damage+' damage':'')+'.';
    if(event?.action==='use_skill') return actor+' used '+String(event.skillId??'a skill').replace(/_/g,' ')+(event.damage!=null?' for '+event.damage+' damage':'')+(event.healAmount!=null?' and healed '+event.healAmount+' HP':'')+'.';
    if(event?.action==='use_item') return actor+' used '+String(event.itemId??'an item').replace(/_/g,' ')+(event.healAmount!=null?' and restored '+event.healAmount+' HP':'')+'.';
    if(event?.healAmount!=null) return actor+' healed for '+event.healAmount+' HP.';
    return actor+' '+action+'.';
  }
}
