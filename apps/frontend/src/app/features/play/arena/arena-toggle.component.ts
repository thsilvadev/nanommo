import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, input } from '@angular/core';
import { LocaleService } from '../../../core/locale.service';
import type { ArenaChoice } from './arena-view-mode';

/**
 * Round button in the map head of a non-town map, same look as the town
 * toggle. It shows the *other* view: on the map a head (go to the arena), in
 * the arena the map. Hidden when the arena cannot run (no WebGL).
 */
@Component({
  selector: 'app-arena-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (available()) {
      <button type="button" class="arena-view-button" [attr.aria-label]="locale.t(target() === 'map' ? 'Map' : 'Character')" [attr.title]="locale.t(target() === 'map' ? 'Map' : 'Character')"
        (pointerdown)="$event.stopPropagation()" (click)="$event.stopPropagation(); go()">
        <img [src]="target() === 'map' ? '/assets/ui/town-view-map.svg' : '/assets/ui/arena-view-head.svg'" alt="" draggable="false" />
      </button>
    }`,
  styles: [`
    :host { display: inline-flex; }
    .arena-view-button { width: 40px; height: 40px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 50%; cursor: pointer;
      background: radial-gradient(circle at 50% 38%, #3a2c46 0%, #1c1524 62%, #0e0a13 100%);
      box-shadow: 0 0 0 2px #d9a441, inset 0 1px 0 rgba(255, 236, 190, 0.35), 0 3px 8px rgba(0, 0, 0, 0.55);
      transition: transform 120ms, box-shadow 120ms; }
    .arena-view-button:hover { transform: translateY(-1px); box-shadow: 0 0 0 2px #e8b955, inset 0 1px 0 rgba(255, 236, 190, 0.45), 0 5px 11px rgba(0, 0, 0, 0.6); }
    .arena-view-button:active { transform: translateY(0); }
    .arena-view-button:focus-visible { outline: 2px solid #ffd36a; outline-offset: 3px; }
    img { width: 30px; height: 30px; display: block; pointer-events: none; user-select: none; }
  `],
})
export class ArenaToggleComponent {
  readonly mode = input.required<ArenaChoice>();
  readonly available = input(true);
  @Output() readonly modeChange = new EventEmitter<ArenaChoice>();
  readonly locale = inject(LocaleService);
  readonly target = computed<ArenaChoice>(() => (this.mode() === 'arena' ? 'map' : 'arena'));

  go(): void {
    this.modeChange.emit(this.target());
  }
}
