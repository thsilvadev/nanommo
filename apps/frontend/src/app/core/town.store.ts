import { EffectRef, Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import type { TownRosterEntry } from '@nanommo/shared';
import { GameSocketService } from './game.socket.service';
import { CharacterStore } from './game.store';
import { ServerClockService } from './server-clock.service';

export interface TownRosterSnapshot { mapId: string | null; serverNow: number; entries: TownRosterEntry[] }
type TownAck = { success: boolean; entry?: TownRosterEntry; error?: string };

/**
 * Client copy of the town scene roster. The server decides which town (if
 * any) the character is in: `mapId` comes from its snapshots, never from a
 * client-side guess. Positions are not here; they are derived from
 * (seed, server time) by the shared `positionAt`.
 */
@Injectable({ providedIn: 'root' })
export class TownStore {
  private readonly socket = inject(GameSocketService);
  private readonly clock = inject(ServerClockService);
  private readonly characters = inject(CharacterStore);
  private readonly injector = inject(Injector);

  private readonly _mapId = signal<string | null>(null);
  private readonly _entries = signal<TownRosterEntry[]>([]);
  readonly mapId = this._mapId.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly self = computed(() => {
    const id = this.characters.character()?.id;
    return id ? this._entries().find(e => e.characterId === id) ?? null : null;
  });

  private subscriptions: Subscription[] = [];
  private syncSequence = 0;
  private mapWatch: EffectRef | null = null;

  start(): void {
    if (this.subscriptions.length) return;
    this.socket.connect();
    this.subscriptions.push(
      this.socket.on<TownRosterSnapshot>('town:roster').subscribe(s => this.applySnapshot(s)),
      this.socket.on<{ mapId: string; entry: TownRosterEntry }>('town:join').subscribe(d => this.upsert(d)),
      this.socket.on<{ mapId: string; entry: TownRosterEntry }>('town:update').subscribe(d => this.upsert(d)),
      this.socket.on<{ mapId: string; characterId: string }>('town:leave').subscribe(d => {
        if (d?.mapId !== this._mapId()) return;
        this._entries.update(list => list.filter(e => e.characterId !== d.characterId));
      }),
      this.socket.onConnectionState().subscribe(state => {
        if (state !== 'connected') return;
        void this.clock.sync();
        void this.syncRoster();
      }),
    );
    // Map changes (travel, arrival) come from the character snapshot: resync when it moves.
    let lastMap: string | null | undefined;
    this.mapWatch = effect(() => {
      const current = this.characters.character()?.currentMapId ?? null;
      if (lastMap !== undefined && current !== lastMap) void this.syncRoster();
      lastMap = current;
    }, { injector: this.injector });
  }

  stop(): void {
    for (const s of this.subscriptions) s.unsubscribe();
    this.subscriptions = [];
    this.mapWatch?.destroy();
    this.mapWatch = null;
    this.syncSequence++;
    this._mapId.set(null);
    this._entries.set([]);
  }

  /** True only for the town scene the server put this character in. */
  isTown(mapId: string | null | undefined): boolean {
    return !!mapId && mapId === this._mapId();
  }

  async syncRoster(): Promise<void> {
    const sequence = ++this.syncSequence;
    try {
      const snapshot = await this.socket.emit<TownRosterSnapshot>('town:syncRoster', undefined);
      if (sequence === this.syncSequence) this.applySnapshot(snapshot);
    } catch {
      // Socket offline: the next `connected` resyncs.
    }
  }

  async sleep(): Promise<void> { await this.intent('town:sleep'); }
  async wake(): Promise<void> { await this.intent('town:wake'); }

  private async intent(event: 'town:sleep' | 'town:wake'): Promise<void> {
    const ack = await this.socket.emit<TownAck>(event, undefined);
    if (!ack?.success || !ack.entry) throw new Error(ack?.error || 'TOWN_ACTION_FAILED');
    this.upsert({ mapId: this._mapId(), entry: ack.entry });
  }

  private applySnapshot(snapshot: TownRosterSnapshot | null | undefined): void {
    if (!snapshot) return;
    this.syncSequence++; // a pushed snapshot supersedes any in-flight sync
    if (Number.isFinite(snapshot.serverNow)) this.clock.seed(snapshot.serverNow);
    this._mapId.set(snapshot.mapId ?? null);
    this._entries.set(Array.isArray(snapshot.entries) ? snapshot.entries : []);
  }

  private upsert(delta: { mapId: string | null; entry: TownRosterEntry } | null | undefined): void {
    if (!delta?.entry || !delta.mapId || delta.mapId !== this._mapId()) return;
    const entry = delta.entry;
    this._entries.update(list => {
      const i = list.findIndex(e => e.characterId === entry.characterId);
      if (i < 0) return [...list, entry];
      const next = list.slice();
      next[i] = entry;
      return next;
    });
  }
}
