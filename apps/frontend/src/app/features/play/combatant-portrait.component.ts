import { Component, Input } from '@angular/core';
import { TooltipPositionDirective } from './tooltip-position.directive';

/** Presentation only: callers provide monster drops, PvP information or other details. */
@Component({
  selector: 'app-combatant-portrait', standalone: true, imports: [TooltipPositionDirective],
  template: `
    <span class="portrait" tabindex="0" [attr.aria-label]="name + ' — details'">
      <img [class]="imageClass" [src]="src" [alt]="name" [width]="width" [height]="height">
      <span class="item-tooltip combatant-details" role="tooltip">
        <strong>{{name}}</strong><ng-content select="[portraitDetails]" />
      </span>
      <ng-content />
    </span>`,
  styles: [`:host{display:inline-flex;flex:0 0 auto;max-width:100%}.portrait{position:relative;display:inline-flex;max-width:100%;cursor:help;border-radius:3px}.portrait:focus-visible{outline:1px solid #c49a50;outline-offset:3px}.portrait img{display:block;max-width:100%;object-fit:contain;image-rendering:pixelated}`],
})
export class CombatantPortraitComponent {
  @Input() src = '';
  @Input() imageClass = '';
  @Input() name = '';
  @Input() width = 167;
  @Input() height = 199;
}
