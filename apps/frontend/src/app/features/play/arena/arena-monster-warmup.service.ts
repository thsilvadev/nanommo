import { Injectable, InjectionToken, computed, effect, inject, untracked, type Signal } from '@angular/core';
import { CatalogService } from '../../../core/catalog.service';
import { BattleStore, CharacterStore } from '../../../core/game.store';
import { releaseMonsterFilesExcept, warmMonsterSpecies } from '../../../shared/monster-viewer/monster-model';
import type { PreloadProgress } from '../game-preload.service';
import { nearbyMonsterIds } from './arena-monster-set';

export interface ArenaMonsterWarmupEnv {
  warm: (ids: string[], onProgress?: PreloadProgress) => Promise<void>;
  release: (ids: string[]) => number;
}
export const ARENA_MONSTER_WARMUP_ENV = new InjectionToken<ArenaMonsterWarmupEnv>('ARENA_MONSTER_WARMUP_ENV', {
  providedIn: 'root',
  factory: () => ({ warm: warmMonsterSpecies, release: releaseMonsterFilesExcept }),
});

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Keeps in memory only the monsters the player can meet soon: those of the current map and its
 * neighbours, plus any species already queued. Warmed on the loading screen, then again on every map
 * change, after which the files out of range (and not on screen) are released.
 */
@Injectable({ providedIn: 'root' })
export class ArenaMonsterWarmup {
  private readonly env = inject(ARENA_MONSTER_WARMUP_ENV);
  private readonly character = inject(CharacterStore);
  private readonly battles = inject(BattleStore);
  private readonly catalog = inject(CatalogService);

  /** Species of the current map and its 8 neighbours (none until both the map and the catalogue are known). */
  private readonly nearby = computed(() => nearbyMonsterIds(this.catalog.maps(), this.character.character()?.currentMapId ?? null), { equal: sameIds });
  /** Species queued for battle (a regenerated queue or a raid can bring one from outside the range). */
  private readonly queued = computed(() => {
    const ids = new Set<string>();
    for (const entry of this.battles.queue()) {
      if (entry.monsterId) ids.add(entry.monsterId);
      const actors = (entry.log as { header?: { v2Input?: { actors?: Array<{ kind?: string; definitionId?: unknown }> } } } | undefined)?.header?.v2Input?.actors;
      for (const actor of actors ?? []) if (actor?.kind === 'monster' && typeof actor.definitionId === 'string') ids.add(actor.definitionId);
    }
    return [...ids].sort();
  }, { equal: sameIds });
  readonly wanted: Signal<string[]> = computed(() => [...new Set([...this.nearby(), ...this.queued()])].sort(), { equal: sameIds });

  /** The set the last warm started for: a warm that finishes after a newer one started does not release. */
  private latest: string[] = [];

  constructor() {
    effect(() => {
      const next = this.wanted();
      // No map or no catalogue yet: nothing is known to be out of range.
      if (!untracked(() => this.nearby()).length) return;
      this.latest = next;
      untracked(() => {
        void this.env.warm(next).catch(() => undefined).then(() => {
          if (this.latest === next) this.env.release(next);
        });
      });
    });
  }

  /** Loading-screen task: waits (up to `waitMs`) for the character's map and the catalogue, then warms the set. */
  async preload(onProgress?: PreloadProgress, waitMs = 15_000): Promise<void> {
    onProgress?.(0, 1);
    const until = Date.now() + waitMs;
    while (!untracked(() => this.nearby()).length && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    // The warm reports its own progress; without a map there is nothing to warm and the task is done.
    if (untracked(() => this.nearby()).length) await this.env.warm(untracked(() => this.wanted()), onProgress).catch(() => undefined);
    else onProgress?.(1, 1);
  }
}
