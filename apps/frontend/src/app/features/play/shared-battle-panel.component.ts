import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { PartyStore } from '../../core/party.store';
import { CharacterStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { SharedEvent, sharedActorResources, sharedCurrentTarget, visibleSharedEvents } from '../../core/party-projection';

@Component({
  selector:'app-shared-battle-panel', standalone:true, imports:[CommonModule],
  template: `
    <section *ngIf="party.battle() as battle" class="shared-combat">
      <header><strong>{{locale.t('Shared battle')}}</strong><small>{{locale.t(battle.state)}} · {{tick()}}</small><button type="button" *ngIf="canFlee()" [disabled]="party.busy()" (click)="party.flee()">{{locale.t('Flee')}}</button></header>
      <p *ngIf="target() as id" class="current-target">{{locale.t('Current target')}}: <strong>{{actorName(id)}}</strong><small *ngIf="targetResources() as resources">HP {{resources.hp}} · SP {{resources.sp}}</small></p>
      <p *ngIf="!events().length">{{locale.t('Waiting for battle events.')}}</p>
      <div class="shared-feed" role="log" aria-live="off" [attr.aria-label]="locale.t('Shared battle log')" tabindex="0">
        <div *ngFor="let event of events()" class="shared-event"><time>{{event.tick*0.5 | number:'1.1-1'}}s</time><span>{{eventText(event)}}</span></div>
      </div>
    </section>`,
  styles:[`:host{display:flex;flex:1;min-height:0;overflow:hidden}.shared-combat{display:flex;flex-direction:column;flex:1;min-height:0;gap:8px;padding:10px;color:#d7c4a4}.shared-combat header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:5px}.shared-combat button{font:11px Arial;padding:3px 8px;color:#e3cfaa;background:#241a11;border:1px solid #78603f;cursor:pointer}.shared-combat button:disabled{opacity:.5}.shared-combat p{margin:0;font:12px/1.4 Arial}.shared-combat small{font:11px Arial}.current-target small{display:block}.shared-feed{flex:1;min-height:90px;max-height:340px;overflow:auto;overscroll-behavior:contain;font:12px/1.45 Arial;border-top:1px solid #4e3e2b}.shared-event{display:flex;gap:6px;padding:5px 0;border-bottom:1px solid #30261c}.shared-event time{color:#a38c68;min-width:32px}.shared-event span{overflow-wrap:anywhere}@media(max-height:700px){.shared-feed{max-height:190px}}`],
})
export class SharedBattlePanelComponent implements OnDestroy {
  readonly party=inject(PartyStore); readonly character=inject(CharacterStore); readonly locale=inject(LocaleService); private readonly catalog=inject(CatalogService);
  readonly now=signal(Date.now()); private readonly timer=setInterval(()=>this.now.set(Date.now()),250);
  tick(): number {const b=this.party.battle();return b?Math.max(0,Math.floor((this.now()-Date.parse(b.startAt))/500)):0;}
  events(): SharedEvent[] {
    const battle=this.party.battle();if(!battle)return [];
    const events=visibleSharedEvents(battle,this.now()).filter(event=>!['range_blocked','action_suppressed'].includes(event.action));
    const firstTick=events[Math.max(0,events.length-120)]?.tick??0;
    return events.filter(event=>event.tick>=firstTick);
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
  eventText(event:SharedEvent):string {
    const actor=this.actorName(event.actorId),targets=(event.targetIds??[]).map(id=>this.actorName(id)).join(', '),payload=event.payload??{};
    let text=`${actor} · ${this.locale.t(event.action.replace(/_/g,' '))}`;
    if(targets)text+=` → ${targets}`;
    if(Number.isFinite(payload['damage']))text+=` · ${payload['damage']}`;
    if(payload['skillId'])text+=` · ${payload['skillId']}`;
    if(payload['itemId'])text+=` · ${payload['itemId']}`;
    return text;
  }
  ngOnDestroy():void{clearInterval(this.timer);}
}
