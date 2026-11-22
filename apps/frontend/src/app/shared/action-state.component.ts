import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { ActionFeedback } from '../core/combat-actions.store';
import { LocaleService } from '../core/locale.service';

@Component({selector:'app-action-state',standalone:true,imports:[CommonModule],changeDetection:ChangeDetectionStrategy.OnPush,
  template:`<span *ngIf="state" class="marker" [attr.data-phase]="state.phase" role="img" tabindex="0" [attr.aria-label]="label()" [title]="label()">
    <svg viewBox="0 0 16 16" aria-hidden="true"><ng-container [ngSwitch]="state.phase">
      <ng-container *ngSwitchCase="'queued'"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5"/></ng-container>
      <ng-container *ngSwitchCase="'failed'"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v4M8 11h.01"/></ng-container>
      <circle *ngSwitchDefault cx="8" cy="8" r="5.5" [attr.stroke-dasharray]="state.phase==='sending'?'23 12':'1.5 3'"/>
    </ng-container></svg><span *ngIf="text" class="caption">{{caption()}}</span>
  </span>`,
  styles:[`:host{display:inline-flex;vertical-align:middle;line-height:1;letter-spacing:normal}:host:not(.corner){margin-inline-start:4px}:host(.corner){position:absolute;right:3px;top:3px;z-index:3}.marker{display:inline-flex;align-items:center;gap:5px;color:#b29a69;outline-offset:2px;cursor:help}.marker svg{display:block;flex:0 0 12px;width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}.caption{font:11px/1.25 Arial,sans-serif}.marker[data-phase=confirming]{color:#9b9c9a}.marker[data-phase=failed]{color:#c7887e}:host(.corner) .marker{padding:2px;border-radius:50%;background:#15110ee8}.marker[data-phase=sending] svg{animation:action-turn 1s linear infinite}@keyframes action-turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.marker[data-phase=sending] svg{animation:none}}`],
})
export class ActionStateComponent {
  @Input() state:ActionFeedback|null=null;
  @Input() text=false;
  @Input() detail='';
  readonly locale=inject(LocaleService);
  caption():string {return this.locale.t(this.state?.phase==='sending'?'Sending':this.state?.phase==='queued'?'Queued':this.state?.phase==='failed'?'Not applied':'Confirming');}
  label():string {
    if(this.state?.phase==='failed')return this.state.message??this.locale.t('Change rejected');
    return (this.detail?this.detail+' · ':'')+this.locale.t(this.state?.phase==='sending'?'Sending change':this.state?.phase==='queued'?'Waiting for a window outside combat. The current battle is unchanged.':'Confirming the change with the server.');
  }
}
