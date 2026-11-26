/**
 * The game's stores at `now` → what the arena draws (scene frame, actor visuals,
 * region). Picks the running battle, the one before it (kept after it leaves the
 * queue, for its outro) and the next one (solo queue, or the party's encounter
 * clock), and the walking party. No three.js, no Angular: unit-tested on its own.
 */
import type { BattleQueueEntry } from '../../../core/game.models';
import type { SharedBattleView } from '../../../core/party-projection';
import type { AttackStyle } from '../../../shared/character-animation/animation-state';
import { fromSharedBattle, fromSoloEntry } from './arena-battle';
import { arenaBattleOffset, arenaScene, arenaSceneEnd, arenaWalkColumn } from './arena-phase';
import { arenaRegionOf } from './arena-region';
import type { ArenaActorVisual, ArenaFrameInput } from './arena-runtime';
import type { ArenaBattle, ArenaBattleOptions, ArenaCharacterLook } from './arena.types';

export interface ArenaResolvedEntry { entryId: string; cancelledAt?: string | null; cancellationReason?: string | null }

export interface ArenaSourceInputs {
  nowMs: number;
  mapId: string | null;
  selfId: string;
  selfLook: ArenaCharacterLook | null;
  selfAttackStyle: AttackStyle;
  /** The solo battle queue (pre-computed entries). */
  soloQueue: BattleQueueEntry[];
  /** Solo battles resolved recently (they leave the queue): a flee or a cancellation cuts them short. */
  resolved: ArenaResolvedEntry[];
  /** The party's latest shared battle, if in a party. */
  shared: SharedBattleView | null;
  /** When this client first saw `shared` (party battles are not known in advance). */
  sharedReceivedAtMs: number | null;
  /** Epoch ms of the party's next encounter. */
  nextEncounterAt: number | null;
  /** Party members in order (self included); empty when solo. */
  partyIds: string[];
  /** How each party member looks now (from the party state): a partner is drawn before any shared battle. */
  memberLooks?: Readonly<Record<string, ArenaCharacterLook | null>>;
  gatherAtMs: number | null;
}

/** Battles kept after they leave the queue (outro, previous) plus the queued ones. */
const KEEP = 12;

export class ArenaSceneSource {
  private readonly battles = new Map<string, ArenaBattle>();
  private readonly memberLooks = new Map<string, ArenaCharacterLook | null>();
  private readonly started = new Set<string>();
  /** Column offset of each battle, fixed the first time it is laid out (see arena-phase). */
  private readonly offsets = new Map<string, number>();
  /** Solo battles cut where they left the queue unresolved, as they were before the cut (see settleSolo). */
  private readonly uncut = new Map<string, ArenaBattle>();

  constructor(private readonly options: ArenaBattleOptions = {}) {}

  build(input: ArenaSourceInputs): ArenaFrameInput {
    const now = input.nowMs;
    const queued = input.soloQueue.filter((e) => !input.mapId || !(e as { mapId?: string }).mapId || (e as { mapId?: string }).mapId === input.mapId);
    const solo = queued.map((e) => this.solo(e, input)).filter((b): b is ArenaBattle => !!b).sort((a, b) => a.startAtMs - b.startAtMs);
    this.settleSolo(new Set(queued.map((e) => e.id)), new Set(input.soloQueue.map((e) => e.id)), input.resolved, now);
    if (input.shared) this.shared(input.shared, input);
    const all = [...this.battles.values()];
    // A battle "ran" once its start passed while known: only those can be the previous one (no phantom outros).
    for (const b of all) if (b.startAtMs <= now) this.started.add(b.id);

    const current = all.find((b) => b.startAtMs <= now && now < arenaSceneEnd(b)) ?? null;
    const previous = all.filter((b) => this.started.has(b.id) && arenaSceneEnd(b) <= now).sort((a, b) => arenaSceneEnd(b) - arenaSceneEnd(a))[0] ?? null;
    const next = solo.find((b) => b.startAtMs > now) ?? null;
    const nextStartAtMs = next?.startAtMs ?? (input.nextEncounterAt !== null && input.nextEncounterAt > now ? input.nextEncounterAt : null);

    const ids = input.partyIds.length ? input.partyIds : [input.selfId];
    const lookOf = (id: string) => (id === input.selfId ? input.selfLook : input.memberLooks?.[id] ?? this.memberLooks.get(id) ?? null);
    const party = ids.map((id) => ({ id, look: lookOf(id) }));
    const offsets = this.layOut(previous, current, next);
    const scene = arenaScene({ nowMs: now, current, previous, next, nextStartAtMs, party, selfId: input.selfId, gatherAtMs: input.gatherAtMs, offsets });

    const visuals = new Map<string, ArenaActorVisual>();
    for (const b of [previous, current, next]) {
      if (!b) continue;
      for (const a of b.actors) visuals.set(a.id, { id: a.id, team: a.team, kind: a.kind, name: a.name, look: a.kind === 'character' ? lookOf(a.id) ?? a.look : null, monsterId: a.monsterId, maxHp: a.maxHp, maxSp: a.maxSp });
    }
    for (const member of party) if (!visuals.has(member.id)) visuals.set(member.id, { id: member.id, team: 'a', kind: 'character', name: member.id, look: member.look, monsterId: null });
    return { scene, visuals, region: arenaRegionOf(input.mapId) };
  }

  /**
   * Each battle is laid out once, where the party stands when it comes up: its rearmost team-a cell on
   * the column the party walks at after the battle before. A battle that never had one (seen only as
   * the previous one) keeps offset 0.
   */
  private layOut(previous: ArenaBattle | null, current: ArenaBattle | null, next: ArenaBattle | null): { previous: number; current: number; next: number } {
    const prev = previous ? this.offsets.get(previous.id) ?? 0 : 0;
    if (previous && !this.offsets.has(previous.id)) this.offsets.set(previous.id, prev);
    const walkColumn = arenaWalkColumn(previous, prev);
    const fix = (b: ArenaBattle) => { if (!this.offsets.has(b.id)) this.offsets.set(b.id, arenaBattleOffset(walkColumn, b)); return this.offsets.get(b.id)!; };
    const cur = current ? fix(current) : 0;
    // The next battle is laid out only between battles (while one runs, the walk column is not known yet).
    const nxt = next ? (current ? this.offsets.get(next.id) ?? 0 : fix(next)) : 0;
    if (this.offsets.size > KEEP * 3) for (const id of [...this.offsets.keys()]) if (![...this.battles.values()].some((b) => b.id === id)) this.offsets.delete(id);
    return { previous: prev, current: cur, next: nxt };
  }

  private solo(entry: BattleQueueEntry, input: ArenaSourceInputs): ArenaBattle | null {
    const key = `solo:${entry.id}`;
    // Back in the queue after a cut (a stale snapshot without it): it was not deleted after all.
    const uncut = this.uncut.get(key);
    if (uncut) { this.uncut.delete(key); this.battles.set(key, uncut); }
    const cached = this.battles.get(key);
    if (cached && cached.startAtMs === Date.parse(entry.startAt)) return cached;
    const battle = fromSoloEntry(entry, { id: input.selfId, look: input.selfLook, attackStyle: input.selfAttackStyle }, this.options);
    if (battle) this.remember(key, battle); else this.battles.delete(key);
    return battle;
  }

  /**
   * Solo entries leave the queue when they resolve (or when a combat change regenerates the queue).
   * A resolved one keeps playing, cut short by its flee / cancellation; one the arena never saw start is
   * gone, even when its start time has passed: the arena is not drawn while hidden, so a battle a trip
   * cancelled meanwhile would otherwise come back as a phantom one.
   *
   * One the arena saw start that leaves the queue with no resolution was deleted by the server (a
   * destination picked, a route committed, a queue rebuilt): it is cut where it left, else it plays on
   * to its original end as a ghost, over the battle the panel and the sounds follow. Its uncut form is
   * kept, so a flee or cancellation reported just after the queue update still plays as reported.
   */
  private settleSolo(queued: Set<string>, present: Set<string>, resolved: ArenaResolvedEntry[], now: number): void {
    for (const key of [...this.uncut.keys()]) if (!this.battles.has(key)) this.uncut.delete(key);
    for (const [key, current] of [...this.battles]) {
      if (!key.startsWith('solo:') || queued.has(current.id)) continue;
      const r = resolved.find((x) => x.entryId === current.id);
      if (r) {
        const battle = this.uncut.get(key) ?? current;
        this.uncut.delete(key);
        const cutAt = Date.parse(String(r.cancelledAt ?? ''));
        if (Number.isFinite(cutAt) && r.cancellationReason === 'flee') this.battles.set(key, battle.flee ? battle : { ...battle, flee: { atMs: cutAt } });
        else if (Number.isFinite(cutAt) && cutAt < battle.endAtMs) this.battles.set(key, { ...battle, endAtMs: cutAt });
        else this.battles.set(key, battle);
      } else if (!this.started.has(current.id)) {
        this.battles.delete(key);
      } else if (!present.has(current.id) && !this.uncut.has(key)) {
        this.uncut.set(key, current);
        if (now < current.endAtMs) this.battles.set(key, { ...current, endAtMs: Math.max(current.startAtMs, now) });
      }
    }
  }

  private shared(view: SharedBattleView, input: ArenaSourceInputs): ArenaBattle {
    const key = `shared:${view.id}:${view.revision}`;
    let battle = this.battles.get(key);
    if (!battle) {
      battle = fromSharedBattle(view, input.selfId, this.options);
      if (input.sharedReceivedAtMs !== null) battle.receivedAtMs = input.sharedReceivedAtMs;
      // A newer revision of the same battle replaces the older one.
      for (const k of [...this.battles.keys()]) if (k.startsWith(`shared:${view.id}:`)) this.battles.delete(k);
      this.remember(key, battle);
    }
    for (const a of battle.actors) if (a.kind === 'character' && a.id !== input.selfId) this.memberLooks.set(a.id, a.look);
    return battle;
  }

  private remember(key: string, battle: ArenaBattle): void {
    this.battles.set(key, battle);
    // Only battles that already ran are dropped, oldest first: a queued one (bounded by the queue itself)
    // must survive until it plays, or it is rebuilt every frame and never becomes the current battle.
    while (this.battles.size > KEEP) {
      const ran = [...this.battles.entries()].filter(([, b]) => this.started.has(b.id)).sort((a, b) => a[1].endAtMs - b[1].endAtMs);
      if (!ran.length) break;
      this.battles.delete(ran[0][0]);
      this.started.delete(ran[0][1].id);
    }
  }
}
