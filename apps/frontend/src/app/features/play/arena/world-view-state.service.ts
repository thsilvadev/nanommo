import { Injectable, signal } from '@angular/core';
import type { MapViewMode } from '../town-scene/town-view-toggle.component';
import type { ArenaChoice, ArenaPlace } from './arena-view-mode';

/**
 * The world panel's view choices (map | arena, map | town) and the last place seen. They live here,
 * not in MapBoard, because MapBoard is destroyed when the player opens another page (/character, …):
 * coming back must show the view that was showing.
 */
@Injectable({ providedIn: 'root' })
export class WorldViewState {
  readonly arenaChoice = signal<ArenaChoice | null>(null);
  readonly townChoice = signal<{ mapId: string; mode: MapViewMode } | null>(null);
  arenaPlace: ArenaPlace | null = null;
  private characterId: string | null = null;

  /** Another character (logout, then login) starts from the defaults. */
  forCharacter(id: string): void {
    if (this.characterId === id) return;
    this.characterId = id;
    this.arenaChoice.set(null);
    this.townChoice.set(null);
    this.arenaPlace = null;
  }
}
