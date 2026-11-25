/**
 * Which view the world panel shows: the map, the town scene (towns only) or
 * the battle arena (non-town maps only). Pure rules; MapBoard keeps the state.
 */
import { mapViewMode, type MapViewMode } from '../town-scene/town-view-toggle.component';

export type WorldView = 'map' | 'town' | 'arena';
export type ArenaChoice = 'map' | 'arena';

export function worldViewMode(input: {
  inTown: boolean; mapId: string | null | undefined;
  townChoice: { mapId: string; mode: MapViewMode } | null;
  arenaChoice: ArenaChoice | null; webgl: boolean;
}): WorldView {
  if (input.inTown) return mapViewMode(true, input.mapId, input.townChoice);
  return input.webgl && input.arenaChoice === 'arena' ? 'arena' : 'map';
}

export interface ArenaPlace { inTown: boolean; traveling: boolean; isGrind: boolean }

/**
 * The arena choice after the character's place changes. It persists across
 * every non-town map (travel hops included) and is cleared by entering a town.
 * Finishing a trip on a grind map (its destination) opens the arena; a battle
 * on the way never switches the view; login or a teleport opens the map.
 */
export function arenaChoiceAfter(prev: ArenaPlace | null, next: ArenaPlace, choice: ArenaChoice | null): ArenaChoice | null {
  if (next.inTown) return null;
  if (prev?.traveling && !next.traveling && next.isGrind) return 'arena';
  return choice;
}

/** Map ↔ arena switch: this long to black, swap, this long back. */
export const ARENA_VIEW_FADE_MS = 1000;
