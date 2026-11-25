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
import { arenaScene } from './arena-phase';
import { arenaRegionOf } from './arena-region';
import type { ArenaActorVisual, ArenaFrameInput } from './arena-runtime';
import type { ArenaBattle, ArenaBattleOptions, ArenaCharacterLook } from './arena.types';

export interface ArenaSourceInputs {
  nowMs: number;
  mapId: string | null;
  selfId: string;
  selfLook: ArenaCharacterLook | null;
  selfAttackStyle: AttackStyle;
  /** The solo battle queue (pre-computed entries). */
  soloQueue: BattleQueueEntry[];
  /** The party's latest shared battle, if in a party. */
  shared: SharedBattleView | null;
  /** When this client first saw `shared` (party battles are not known in advance). */
  sharedReceivedAtMs: number | null;
  /** Epoch ms of the party's next encounter. */
  nextEncounterAt: number | null;
  /** Party members in order (self included); empty when solo. */
  partyIds: string[];
  gatherAtMs: number | null;
}

/** Battles kept after they leave the queue (outro, previous). */
const KEEP = 6;

export class ArenaSceneSource {
  private readonly battles = new Map<string, ArenaBattle>();
  private readonly memberLooks = new Map<string, ArenaCharacterLook | null>();

  constructor(private readonly options: ArenaBattleOptions = {}) {}

  build(input: ArenaSourceInputs): ArenaFrameInput {
    const now = input.nowMs;
    const solo = input.soloQueue
      .filter((e) => !input.mapId || !(e as { mapId?: string }).mapId || (e as { mapId?: string }).mapId === input.mapId)
      .map((e) => this.solo(e, input))
      .filter((b): b is ArenaBattle => !!b)
      .sort((a, b) => a.startAtMs - b.startAtMs);
    const shared = input.shared ? this.shared(input.shared, input) : null;
    const known = [...solo, ...(shared ? [shared] : [])];

    const current = known.find((b) => b.startAtMs <= now && now < b.endAtMs) ?? null;
    const previous = [...this.battles.values()].filter((b) => b.endAtMs <= now).sort((a, b) => b.endAtMs - a.endAtMs)[0] ?? null;
    const next = solo.find((b) => b.startAtMs > now) ?? null;
    const nextStartAtMs = next?.startAtMs ?? (input.nextEncounterAt !== null && input.nextEncounterAt > now ? input.nextEncounterAt : null);

    const ids = input.partyIds.length ? input.partyIds : [input.selfId];
    const lookOf = (id: string) => (id === input.selfId ? input.selfLook : this.memberLooks.get(id) ?? null);
    const party = ids.map((id) => ({ id, look: lookOf(id) }));
    const scene = arenaScene({ nowMs: now, current, previous, next, nextStartAtMs, party, selfId: input.selfId, gatherAtMs: input.gatherAtMs });

    const visuals = new Map<string, ArenaActorVisual>();
    for (const b of [previous, current, next]) {
      if (!b) continue;
      for (const a of b.actors) visuals.set(a.id, { id: a.id, team: a.team, kind: a.kind, name: a.name, look: a.kind === 'character' ? lookOf(a.id) ?? a.look : null, monsterId: a.monsterId, maxHp: a.maxHp, maxSp: a.maxSp });
    }
    for (const member of party) if (!visuals.has(member.id)) visuals.set(member.id, { id: member.id, team: 'a', kind: 'character', name: member.id, look: member.look, monsterId: null });
    return { scene, visuals, region: arenaRegionOf(input.mapId) };
  }

  private solo(entry: BattleQueueEntry, input: ArenaSourceInputs): ArenaBattle | null {
    const key = `solo:${entry.id}:${entry.startAt}:${(entry as { cancelledAt?: string | null }).cancelledAt ?? ''}`;
    let battle = this.battles.get(key) ?? null;
    if (!battle) {
      battle = fromSoloEntry(entry, { id: input.selfId, look: input.selfLook, attackStyle: input.selfAttackStyle }, this.options);
      if (battle) this.remember(key, battle);
    }
    return battle;
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
    if (this.battles.size <= KEEP) return;
    const oldest = [...this.battles.entries()].sort((a, b) => a[1].endAtMs - b[1].endAtMs)[0];
    this.battles.delete(oldest[0]);
  }
}
