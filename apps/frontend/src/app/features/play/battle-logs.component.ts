import { battleEventText, battleEventTone, visibleBattleEvent } from './battle-event-text';
import { CatalogService } from '../../core/catalog.service';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { BattleHistoryEntry, BattleLogDetail } from '../../core/game.models';
import { CharacterStore } from '../../core/game.store';

@Component({selector:'app-battle-logs',standalone:true,imports:[CommonModule],templateUrl:'./battle-logs.component.html',styleUrl:'./battle-logs.component.css'})
export class BattleLogsComponent {
  private readonly catalog=inject(CatalogService);
  eventTone=battleEventTone;
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
  displayEvents(battle:BattleLogDetail){return (battle.log?.events??[]).filter(visibleBattleEvent);}
  eventText(event:any){
    const log:any=this.selected()?.log;
    const player=String(log?.header?.characterSnapshot?.characterName??this.character.character()?.name??'Character');
    const enemy=String(this.selected()?.monsterName??'Enemy');
    return battleEventText(event,event.actor==='character'?player:enemy,event.target==='character'?player:enemy,
      (id,kind)=>String(kind==='item'?this.catalog.itemName(id):kind==='status'?this.catalog.statusEffect(id)?.name??id.replace(/_/g,' '):this.catalog.skills().find((s:any)=>s.id===id)?.name??id.replace(/_/g,' ')));
  }
}
