import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, input } from '@angular/core';
import { LocaleService } from '../../../core/locale.service';

export type MapViewMode = 'map' | 'town';

/**
 * Which view the map area shows. In a town the town scene (house) is the
 * default; the player's choice sticks only while staying in that town.
 */
export function mapViewMode(inTown: boolean, mapId: string | null | undefined, choice: { mapId: string; mode: MapViewMode } | null): MapViewMode {
  if (!inTown) return 'map';
  return choice && choice.mapId === mapId ? choice.mode : 'town';
}

/** Two icon-only buttons in the map head: map | house. */
@Component({
  selector: 'app-town-view-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view-toggle" role="group" (pointerdown)="$event.stopPropagation()" (click)="$event.stopPropagation()">
      <button type="button" [attr.aria-label]="locale.t('Map')" [attr.title]="locale.t('Map')" [attr.aria-pressed]="mode() === 'map'" [class.active]="mode() === 'map'" (click)="choose('map')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" /><path d="M9 4v13.5M15 6.5V20" /></svg>
      </button>
      <button type="button" [attr.aria-label]="locale.t('Town')" [attr.title]="locale.t('Town')" [attr.aria-pressed]="mode() === 'town'" [class.active]="mode() === 'town'" (click)="choose('town')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5.5h4V20" /></svg>
      </button>
    </div>`,
  styles: [`
    :host { display: inline-flex; }
    .view-toggle { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(12, 10, 20, 0.62); box-shadow: inset 0 0 0 1px rgba(255, 225, 160, 0.28), 0 2px 6px rgba(0, 0, 0, 0.45); }
    button { width: 34px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 999px; background: transparent; color: rgba(255, 240, 210, 0.7); cursor: pointer; transition: background 120ms, color 120ms; }
    button:hover { color: #fff3d6; }
    button.active { background: linear-gradient(#d9a441, #9a6a22); color: #1d1408; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35); }
    button:focus-visible { outline: 2px solid #ffd36a; outline-offset: 1px; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
  `],
})
export class TownViewToggleComponent {
  readonly mode = input.required<MapViewMode>();
  @Output() readonly modeChange = new EventEmitter<MapViewMode>();
  readonly locale = inject(LocaleService);

  choose(mode: MapViewMode): void {
    if (mode !== this.mode()) this.modeChange.emit(mode);
  }
}
