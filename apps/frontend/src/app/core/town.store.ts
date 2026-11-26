import { EffectRef, Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import type { TownEmoteKind, TownEventSnapshot, TownEventVase, TownEventVaseBroken, TownRosterEntry } from '@nanommo/shared';
import { GameSocketService } from './game.socket.service';
import { CharacterStore, InventoryStore } from './game.store';
import { ServerClockService } from './server-clock.service';

export interface TownRosterSnapshot { mapId: string | null; serverNow: number; entries: TownRosterEntry[]; event?: TownEventSnapshot | null }
type TownAck = { success: boolean; entry?: TownRosterEntry; error?: string };
type HitVaseAck = { success: boolean; vaseId?: string; error?: string; prize?: { itemId: string; quantity: number; via: 'bag' | 'mail' | 'pending' } | null };
export interface TownVaseEvent { eventKey: string; startsAt: number; endsAt: number; vases: TownEventVase[] }
/** What the event music needs: which event (a new one restarts it), when it began and the server time now. */
export interface TownEventMusic { key: string; startsAt: number; now: number }

/** Event start; a payload from an older server has none (the music then starts from the top). */
const eventStart = (e: { startsAt?: number; endsAt: number }): number => (Number.isFinite(e.startsAt) ? Number(e.startsAt) : Date.now());

/** Client-side mirror of the server rules (the server stays the authority). */
export const VASE_HIT_RANGE = 1.0;
export const TOWN_ATTACK_COOLDOWN_MS = 1000;
/** How often a pending vase hit re-checks range and cooldown. */
const VASE_HIT_POLL_MS = 100;
/** A pending hit gives up after this long (path blocked, player wandered off). */
const VASE_HIT_GIVE_UP_MS = 15_000;

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

  /** Another player picked in the town scene (shown under the NPC selector). */
  private readonly _selectedCharacterId = signal<string | null>(null);
  readonly selectedCharacterId = this._selectedCharacterId.asReadonly();
  /** The selected player while it is still in this town; null once it leaves. */
  readonly selectedCharacter = computed(() => {
    const id = this._selectedCharacterId();
    return id ? this._entries().find(e => e.characterId === id) ?? null : null;
  });

  selectCharacter(characterId: string | null): void {
    this._selectedCharacterId.set(characterId && characterId !== this.characters.character()?.id ? characterId : null);
  }

  /** Smashing Spree (Quebra-Quebra): the live vases of this town, or null. */
  private readonly _vaseEvent = signal<TownVaseEvent | null>(null);
  readonly vaseEvent = this._vaseEvent.asReadonly();
  private readonly breaks = new Subject<TownEventVaseBroken>();
  readonly vaseBreaks: Observable<TownEventVaseBroken> = this.breaks.asObservable();
  private readonly said = new Subject<{ characterId: string; message: string }>();
  /** Global chat lines said by someone in my town now (speech bubbles). */
  readonly speech: Observable<{ characterId: string; message: string }> = this.said.asObservable();
  private vaseEndTimer: ReturnType<typeof setTimeout> | null = null;
  private selfPosition: (() => [number, number] | null) | null = null;
  private pendingHit: { vaseId: string; since: number; reapproached: boolean } | null = null;
  private hitTimer: ReturnType<typeof setInterval> | null = null;
  private hitInFlight = false;
  private lastHitSentAt = -Infinity;

  private subscriptions: Subscription[] = [];
  private syncSequence = 0;
  private mapWatch: EffectRef | null = null;

  start(): void {
    if (this.subscriptions.length) return;
    this.socket.connect();
    this.subscriptions.push(
      this.socket.on<TownRosterSnapshot>('town:roster').subscribe(s => this.applySnapshot(s)),
      this.socket.on<{ mapId: string; entry: TownRosterEntry }>('town:join').subscribe(d => {
        // My own join (a trip cancelled in town, an arrival): take the authoritative roster.
        if (d?.entry && d.entry.characterId === this.characters.character()?.id && d.mapId !== this._mapId()) { void this.syncRoster(); return; }
        this.upsert(d);
      }),
      this.socket.on<{ mapId: string; entry: TownRosterEntry }>('town:update').subscribe(d => this.upsert(d)),
      this.socket.on<{ mapId: string; characterId: string }>('town:leave').subscribe(d => {
        if (d?.mapId !== this._mapId()) return;
        if (d.characterId === this.characters.character()?.id) {
          // I left (trip started): my town scene closes now, not when currentMapId changes later.
          this._mapId.set(null);
          this._entries.set([]);
          this._selectedCharacterId.set(null);
          // Out of town: its event (vases, music) is no longer mine.
          this.setVaseEvent(null);
          void this.syncRoster();
          return;
        }
        this._entries.update(list => list.filter(e => e.characterId !== d.characterId));
      }),
      this.socket.on<{ mapId: string } & TownVaseEvent>('town:event:vases').subscribe(d => {
        if (d?.mapId && d.mapId === this._mapId()) this.setVaseEvent({ eventKey: d.eventKey, startsAt: eventStart(d), endsAt: d.endsAt, vases: d.vases ?? [] });
      }),
      this.socket.on<TownEventVaseBroken>('town:event:vaseBroken').subscribe(d => {
        const current = this._vaseEvent();
        if (!d || d.mapId !== this._mapId() || !current || d.eventKey !== current.eventKey) return;
        this._vaseEvent.set({ ...current, vases: current.vases.filter(v => v.id !== d.vaseId) });
        if (this.pendingHit?.vaseId === d.vaseId && d.byCharacterId !== this.characters.character()?.id) this.cancelPendingHit();
        this.breaks.next(d);
      }),
      this.socket.on<{ channel?: string; senderCharacterId?: string; message?: string; type?: string; key?: string }>('chat:message').subscribe(row => {
        // Players' own words only (announcements carry a type/key and no sender).
        if (!row || row.channel !== 'global' || !row.senderCharacterId || row.type || row.key || typeof row.message !== 'string') return;
        if (!this._mapId() || !this._entries().some(e => e.characterId === row.senderCharacterId)) return;
        this.said.next({ characterId: row.senderCharacterId, message: row.message });
      }),
      this.socket.on<{ mapId: string; eventKey: string }>('town:event:ended').subscribe(d => {
        if (d?.mapId === this._mapId() && d.eventKey === this._vaseEvent()?.eventKey) this.setVaseEvent(null);
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
    this._selectedCharacterId.set(null);
    this.setVaseEvent(null);
  }

  /**
   * The live Smashing Spree of the town this character is in, for the event music; null
   * when there is none, it is over, or the character is elsewhere. Polled by the audio
   * service: arriving mid-event, leaving and coming back all follow from this state.
   */
  eventMusic(): TownEventMusic | null {
    const event = this._vaseEvent();
    const mapId = this._mapId();
    if (!event || !mapId || mapId !== (this.characters.character()?.currentMapId ?? null)) return null;
    const now = this.clock.now();
    return now < event.endsAt ? { key: event.eventKey, startsAt: event.startsAt, now } : null;
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
  /** Click-to-move to a ground point or up to an NPC (also wakes and ends emotes). Cancels a pending vase hit. */
  async moveTo(target: { x: number; z: number } | { npcId: string }): Promise<void> {
    this.cancelPendingHit();
    await this.intent('town:move', target);
  }

  /** The town scene tells the store where the local character stands (world x, z). */
  setSelfPosition(provider: (() => [number, number] | null) | null): void { this.selfPosition = provider; }

  /**
   * Click on a vase: hit it now when in range and off cooldown; otherwise walk
   * up to it and hit on arrival. A newer vase click or a ground click replaces it.
   */
  async breakVase(vaseId: string): Promise<void> {
    if (!this._vaseEvent()?.vases.some(v => v.id === vaseId)) return;
    this.pendingHit = { vaseId, since: Date.now(), reapproached: false };
    if (!this.inRange(vaseId)) await this.approach(vaseId);
    this.ensureHitLoop();
    await this.tryHit();
  }

  private async approach(vaseId: string): Promise<void> {
    try {
      const ack = await this.socket.emit<TownAck>('town:move', { vaseId });
      if (ack?.success && ack.entry) this.upsert({ mapId: this._mapId(), entry: ack.entry });
      else if (this.pendingHit?.vaseId === vaseId) this.cancelPendingHit();
    } catch {
      // Offline: the pending hit gives up on its own.
    }
  }

  private inRange(vaseId: string): boolean {
    const vase = this._vaseEvent()?.vases.find(v => v.id === vaseId);
    const at = this.selfPosition?.();
    return !!vase && !!at && Math.hypot(at[0] - vase.x, at[1] - vase.z) <= VASE_HIT_RANGE;
  }

  private ensureHitLoop(): void {
    if (this.hitTimer) return;
    this.hitTimer = setInterval(() => void this.tryHit(), VASE_HIT_POLL_MS);
  }

  private cancelPendingHit(): void {
    this.pendingHit = null;
    if (this.hitTimer) { clearInterval(this.hitTimer); this.hitTimer = null; }
  }

  private async tryHit(): Promise<void> {
    const pending = this.pendingHit;
    if (!pending || this.hitInFlight) return;
    if (Date.now() - pending.since > VASE_HIT_GIVE_UP_MS || !this._vaseEvent()?.vases.some(v => v.id === pending.vaseId)) { this.cancelPendingHit(); return; }
    if (Date.now() - this.lastHitSentAt < TOWN_ATTACK_COOLDOWN_MS || !this.inRange(pending.vaseId)) return;
    this.hitInFlight = true;
    this.lastHitSentAt = Date.now();
    try {
      const ack = await this.socket.emit<HitVaseAck>('town:hitVase', { vaseId: pending.vaseId });
      if (this.pendingHit !== pending) return;
      if (ack?.success) {
        this.cancelPendingHit();
        if (ack.prize?.via === 'bag') void this.injector.get(InventoryStore, null)?.load();
      } else if (ack?.error === 'OUT_OF_RANGE' && !pending.reapproached) {
        pending.reapproached = true;
        await this.approach(pending.vaseId);
      } else if (ack?.error !== 'COOLDOWN' && ack?.error !== 'OUT_OF_RANGE') {
        this.cancelPendingHit();
      }
    } catch {
      // Socket error: keep trying until give-up.
    } finally {
      this.hitInFlight = false;
    }
  }

  private setVaseEvent(event: TownVaseEvent | null): void {
    if (this.vaseEndTimer) { clearTimeout(this.vaseEndTimer); this.vaseEndTimer = null; }
    if (event && event.endsAt <= this.clock.now()) event = null;
    this._vaseEvent.set(event);
    if (!event) { this.cancelPendingHit(); return; }
    this.vaseEndTimer = setTimeout(() => this.setVaseEvent(null), event.endsAt - this.clock.now());
  }
  /** `/dance`, `/sit`; the same one again stops it. */
  async emote(kind: TownEmoteKind): Promise<void> { await this.intent('town:emote', { kind }); }

  private async intent(event: 'town:sleep' | 'town:wake' | 'town:move' | 'town:emote', payload?: unknown): Promise<void> {
    const ack = await this.socket.emit<TownAck>(event, payload);
    if (!ack?.success || !ack.entry) throw new Error(ack?.error || 'TOWN_ACTION_FAILED');
    this.upsert({ mapId: this._mapId(), entry: ack.entry });
  }

  private applySnapshot(snapshot: TownRosterSnapshot | null | undefined): void {
    if (!snapshot) return;
    this.syncSequence++; // a pushed snapshot supersedes any in-flight sync
    if (Number.isFinite(snapshot.serverNow)) this.clock.seed(snapshot.serverNow);
    if ((snapshot.mapId ?? null) !== this._mapId()) this._selectedCharacterId.set(null);
    this._mapId.set(snapshot.mapId ?? null);
    this._entries.set(Array.isArray(snapshot.entries) ? snapshot.entries : []);
    const event = snapshot.mapId && snapshot.event?.mapId === snapshot.mapId ? snapshot.event : null;
    this.setVaseEvent(event ? { eventKey: event.eventKey, startsAt: eventStart(event), endsAt: event.endsAt, vases: event.vases ?? [] } : null);
  }

  private upsert(delta: { mapId: string | null; entry: TownRosterEntry } | null | undefined): void {
    if (!delta?.entry || !delta.mapId || delta.mapId !== this._mapId()) return;
    const entry = delta.entry;
    this._entries.update(list => {
      const i = list.findIndex(e => e.characterId === entry.characterId);
      if (i < 0) return [...list, entry];
      // The ack and the broadcast of the same change race; never let an older one win.
      if ((list[i].rev ?? 0) > (entry.rev ?? 0)) return list;
      const next = list.slice();
      next[i] = entry;
      return next;
    });
  }
}
