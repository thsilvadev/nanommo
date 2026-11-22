import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { CombatTimer } from '../../shared/combat-timers';
import { TooltipPositionDirective } from './tooltip-position.directive';

@Component({
  selector:'app-combat-timers',standalone:true,imports:[CommonModule,TooltipPositionDirective],
  changeDetection:ChangeDetectionStrategy.OnPush,
  template:`<div class="combat-timers" [attr.aria-label]="locale.t('Status and cooldowns')">
    <span *ngFor="let timer of ordered(); trackBy: track" class="combat-timer status-icon" [attr.data-kind]="kind(timer)" tabindex="0" [attr.aria-label]="label(timer)">
      <img [src]="icon(timer)" [alt]="name(timer)" (error)="fallback($event,timer)">
      <span *ngIf="timer.kind!=='status'" class="cooldown-sweep" [style.background]="sweep(timer)" aria-hidden="true"></span>
      <span *ngIf="timer.kind==='status' && finite(timer.remainingSeconds)" class="duration" aria-hidden="true">{{ceil(timer.remainingSeconds)}}</span>
      <span class="status-tooltip" role="tooltip"><strong>{{name(timer)}}</strong><span>{{timer.kind==='status' ? locale.t('Duration') : locale.t('Cooldown')}}: {{remaining(timer)}}</span><span *ngIf="timer.stacks && timer.stacks>1">{{locale.t('Stacks')}}: {{timer.stacks}}</span><span *ngIf="description(timer)">{{description(timer)}}</span></span>
    </span>
  </div>`,styleUrl:'./combat-timers.component.css',
})
export class CombatTimersComponent {
  @Input() timers: CombatTimer[] = [];
  readonly catalog=inject(CatalogService);
  readonly locale=inject(LocaleService);
  readonly ceil=Math.ceil;
  readonly finite=Number.isFinite;
  track(_index:number,timer:CombatTimer) { return timer.key; }
  kind(timer:CombatTimer): string { return timer.kind==='status' ? (this.catalog.statusEffect(timer.id)?.polarity==='buff'?'buff':'debuff') : timer.kind; }
  ordered(): CombatTimer[] {
    const order:Record<string,number>={buff:0,debuff:1,item:2,skill:3};
    return this.timers.slice().sort((a,b)=>(order[this.kind(a)]-order[this.kind(b)]) || a.key.localeCompare(b.key));
  }
  private definition(timer:CombatTimer): any { return timer.kind==='status'?this.catalog.statusEffect(timer.id):timer.kind==='skill'?this.catalog.skills().find(skill=>skill.id===timer.id):this.catalog.item(timer.id); }
  name(timer:CombatTimer): string {
    const category:Record<string,string>={potion:'Potions',tonic:'Tonics',super_tonic:'Super Tonics'};
    return timer.kind==='item' && category[timer.id] ? this.locale.t(category[timer.id]) : this.locale.localized(this.definition(timer),'name',timer.id.replace(/_/g,' '));
  }
  description(timer:CombatTimer): string { return this.locale.localized(this.definition(timer),'description'); }
  remaining(timer:CombatTimer): string { return Number.isFinite(timer.remainingSeconds)?`${Math.ceil(timer.remainingSeconds)}s`:this.locale.t('Until removed'); }
  label(timer:CombatTimer): string { return `${this.name(timer)} · ${this.locale.t(timer.kind==='status'?'Duration':'Cooldown')}: ${this.remaining(timer)}`; }
  icon(timer:CombatTimer): string {
    if (timer.kind==='item') return ['potion','tonic','super_tonic'].includes(timer.id)?`/assets/ui/cooldowns/${timer.id}.svg`:this.catalog.itemIcon(timer.id);
    return `/assets/ui/${timer.kind==='status'?'status':'skill-icons'}/${timer.id}.svg`;
  }
  // The dark part is the time still unavailable, clearing clockwise from noon.
  sweep(timer:CombatTimer): string { return `conic-gradient(from 0deg, transparent ${360*(1-timer.fraction)}deg, rgba(0,0,0,.78) 0deg)`; }
  fallback(event:Event,timer:CombatTimer): void {
    const image=event.target as HTMLImageElement;
    if (image.dataset['fallback']) return;
    image.dataset['fallback']='true';
    image.src=`/assets/ui/cooldowns/${timer.kind==='status'?'status':timer.kind==='skill'?'skill':'potion'}.svg`;
  }
}
