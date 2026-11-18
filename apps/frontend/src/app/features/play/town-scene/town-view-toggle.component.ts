import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, input } from '@angular/core';
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

/**
 * One round illustrated button in the map head. It shows the *other* view:
 * in the town it shows the map (and goes to the map); on the map it shows
 * the house (and goes back to the town).
 */
@Component({
  selector: 'app-town-view-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="town-view-button" [attr.aria-label]="locale.t(target() === 'map' ? 'Map' : 'Town')" [attr.title]="locale.t(target() === 'map' ? 'Map' : 'Town')"
      (pointerdown)="$event.stopPropagation()" (click)="$event.stopPropagation(); go()">
      <img [src]="target() === 'map' ? '/assets/ui/town-view-map.svg' : '/assets/ui/town-view-house.svg'" alt="" draggable="false" />
    </button>`,
  styles: [`
    :host { display: inline-flex; }
    .town-view-button { width: 40px; height: 40px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 50%; cursor: pointer;
      background: radial-gradient(circle at 50% 38%, #3a2c46 0%, #1c1524 62%, #0e0a13 100%);
      box-shadow: 0 0 0 2px #d9a441, inset 0 1px 0 rgba(255, 236, 190, 0.35), 0 3px 8px rgba(0, 0, 0, 0.55);
      transition: transform 120ms, box-shadow 120ms; }
    .town-view-button:hover { transform: translateY(-1px); box-shadow: 0 0 0 2px #e8b955, inset 0 1px 0 rgba(255, 236, 190, 0.45), 0 5px 11px rgba(0, 0, 0, 0.6); }
    .town-view-button:active { transform: translateY(0); }
    .town-view-button:focus-visible { outline: 2px solid #ffd36a; outline-offset: 3px; }
    img { width: 30px; height: 30px; display: block; pointer-events: none; user-select: none; }
  `],
})
export class TownViewToggleComponent {
  readonly mode = input.required<MapViewMode>();
  @Output() readonly modeChange = new EventEmitter<MapViewMode>();
  readonly locale = inject(LocaleService);
  readonly target = computed<MapViewMode>(() => (this.mode() === 'town' ? 'map' : 'town'));

  go(): void {
    this.modeChange.emit(this.target());
  }
}
