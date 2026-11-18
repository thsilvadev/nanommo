import { CombatantPortraitComponent } from './combatant-portrait.component';
import { FollowLogDirective } from './follow-log.directive';
import { battleEventText, battleEventTone, visibleBattleEvent } from './battle-event-text';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { PartyStore } from '../../core/party.store';
import { CharacterStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { SharedEvent, sharedActorResources, sharedCurrentTarget, visibleSharedEvents } from '../../core/party-projection';

@Component({
  selector:'app-shared-battle-panel', standalone:true, imports:[CommonModule, FollowLogDirective, CombatantPortraitComponent],
  template: `
    <section *ngIf="party.battle() as battle" class="shared-combat">
      <header><strong>{{locale.t('Shared battle')}}</strong><small>{{locale.t(battle.state)}} · {{tick()}}</small><button type="button" *ngIf="canFlee()" [disabled]="party.busy()" (click)="party.flee()">{{locale.t('Flee')}}</button></header>
      <p *ngIf="target() as id" class="current-target">{{locale.t('Current target')}}: <strong>{{actorName(id)}}</strong><small *ngIf="targetResources() as resources">HP {{resources.hp}} · SP {{resources.sp}}</small></p>
      <p *ngIf="!events().length">{{locale.t('Waiting for battle events.')}}</p>
      <div class="enemy-portraits" *ngIf="dropTables().length">
        <app-combatant-portrait *ngFor="let monster of dropTables(); trackBy: trackPortrait" [src]="monster.src" [name]="monster.name" [width]="38" [height]="44">
          <div portraitDetails><small class="portrait-section-label">DROP RATES</small>
            <div *ngFor="let drop of monster.drops" class="portrait-detail-row"><span>{{drop.name}}</span><b>{{drop.percent | number:'1.0-3'}}%</b></div>
            <small *ngIf="!monster.drops.length">No listed drops.</small>
          </div>
        </app-combatant-portrait>
      </div>
      <div class="shared-feed" followLog role="log" aria-live="off" [attr.aria-label]="locale.t('Shared battle log')" tabindex="0">
        <div *ngFor="let event of events()" class="shared-event" [attr.data-tone]="eventTone(event)"><time>{{event.tick*0.5 | number:'1.1-1'}}s</time><span>{{eventText(event)}}</span></div>
      </div>
    </section>`,
  styles:[`:host{display:flex;flex:1;min-height:0;overflow:hidden}.shared-combat{display:flex;flex-direction:column;flex:1;min-height:0;gap:8px;padding:10px;color:#d7c4a4}.shared-combat header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:5px}.shared-combat button{font:11px Arial;padding:3px 8px;color:#e3cfaa;background:#241a11;border:1px solid #78603f;cursor:pointer}.shared-combat button:disabled{opacity:.5}.enemy-portraits{display:flex;flex-wrap:wrap;gap:8px;flex:0 0 auto}.shared-combat p{margin:0;font:12px/1.4 Arial}.shared-combat small{font:11px Arial}.current-target small{display:block}.shared-feed{flex:1;min-height:90px;max-height:340px;overflow:auto;overscroll-behavior:contain;font:12px/1.45 Arial;border-top:1px solid #4e3e2b}.shared-event{display:flex;gap:6px;padding:5px 0;border-bottom:1px solid #30261c}.shared-event time{color:#a38c68;min-width:32px}.shared-event span{overflow-wrap:anywhere}@media(max-height:700px){.shared-feed{max-height:190px}}`],
})
export class SharedBattlePanelComponent implements OnDestroy {
  readonly party=inject(PartyStore); readonly character=inject(CharacterStore); readonly locale=inject(LocaleService); private readonly catalog=inject(CatalogService);
  readonly now=signal(Date.now()); private readonly timer=setInterval(()=>this.now.set(Date.now()),250);
  tick(): number {const b=this.party.battle();return b?Math.max(0,Math.floor((this.now()-Date.parse(b.startAt))/500)):0;}
  events(): SharedEvent[] {
    const battle=this.party.battle();if(!battle)return [];
    const events=visibleSharedEvents(battle,this.now()).filter(visibleBattleEvent);
    return events;
  }
  canFlee():boolean { return this.party.party()?.leaderCharacterId===this.character.character()?.id && this.party.battle()?.state==='started'; }
  target(): string|null {const b=this.party.battle(),id=this.character.character()?.id;return b&&id?sharedCurrentTarget(b,id,this.now()):null;}
  targetResources(){const b=this.party.battle(),id=this.target();return b&&id?sharedActorResources(b,id,this.now()):null;}
  actorName(id:string): string {
    const actors=this.party.battle()?.snapshot.actors??[],actor=actors.find(value=>value.id===id);
    if(!actor)return id;
    const name=actor.name??actor.snapshot.name??((actor.monsterId??actor.definitionId)?this.catalog.monster(actor.monsterId??actor.definitionId??'')?.name:null)??id;
    const number=actors.filter(value=>value.team===actor.team).findIndex(value=>value.id===id)+1;
    return `${name} #${number}`;
  }
  dropTables() {
    const actors=this.party.battle()?.snapshot.actors??[];
    return actors.filter(actor=>actor.team==='b' && actor.kind==='monster' && (actor.monsterId || actor.definitionId)).map(actor=>{
      const definition=this.catalog.monster(actor.monsterId??actor.definitionId??'');
      return {id:actor.id,src:'/assets/monsters/'+(actor.monsterId??actor.definitionId)+'.svg',name:this.actorName(actor.id),drops:(definition?.drops??[]).map(drop=>({name:this.catalog.itemName(drop.itemId),percent:Number(drop.chance)*100}))};
    });
  }
  trackPortrait(_index: number, monster: {id: string}) { return monster.id; }
  eventTone(event: SharedEvent) { const actor=this.party.battle()?.snapshot.actors.find(a=>a.id===event.actorId); return battleEventTone({...event, actor:actor?.team==='a'?'character':'monster'}); }
  eventText(event:SharedEvent):string {
    return battleEventText(event, this.actorName(event.actorId), (event.targetIds??[]).map(id=>this.actorName(id)).join(', ') || this.actorName(event.actorId),
      (id,kind)=>String(kind==='item'?this.catalog.itemName(id):kind==='status'?this.catalog.statusEffect(id)?.name??id.replace(/_/g,' '):this.catalog.skills().find((s:any)=>s.id===id)?.name??id.replace(/_/g,' ')));
  }
  ngOnDestroy():void{clearInterval(this.timer);}
}
