/**
 * Solo queue entries and shared (party) battles → one ArenaBattle, so the
 * projection and the renderer never know which source a battle came from.
 */
import type { CharacterAppearance, Sex, VisibleEquipment, VisibleRefinement } from '@nanommo/shared';
import type { AttackStyle } from '../../../shared/character-animation/animation-state';
import type { BattleQueueEntry } from '../../../core/game.models';
import type { SharedBattleView } from '../../../core/party-projection';
import type { ArenaActorDef, ArenaBattle, ArenaBattleOptions, ArenaCell, ArenaCharacterLook, ArenaEvent } from './arena.types';

const ms = (value: unknown): number => Date.parse(String(value ?? ''));
const outcomeOf = (value: unknown): 'win' | 'loss' | null => (value === 'win' || value === 'loss' ? value : null);
const styleOfLook = (look: ArenaCharacterLook | null): AttackStyle => (look?.mainHandType === 'bow' || look?.offHandType === 'bow' ? 'bow' : 'melee');

/** The solo entry's own V2 log; null for a legacy (V1) entry or unusable timing. */
export function fromSoloEntry(
  entry: BattleQueueEntry,
  self: { id: string; look: ArenaCharacterLook | null; attackStyle: AttackStyle },
  options: ArenaBattleOptions = {},
): ArenaBattle | null {
  const log = (entry as { log?: any }).log;
  const input = log?.header?.v2Input;
  const rawEvents: ArenaEvent[] | undefined = log?.v2Events;
  if (!input || !Array.isArray(input.actors) || !Array.isArray(rawEvents)) return null;
  // The solo log names the character actor after its snapshot ('character' when the snapshot has no
  // characterId, as the API's does); the arena knows the viewer by character id, so rename it.
  const logSelfId: string | undefined = input.actors.find((actor: any) => actor.kind === 'character')?.id;
  const rename = (id: string) => (id === logSelfId ? self.id : id);
  const events = logSelfId && logSelfId !== self.id ? rawEvents.map((e) => renameEvent(e, rename)) : rawEvents;
  const startAtMs = ms(entry.startAt), endAtMs = ms(entry.endAt);
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) return null;
  const actors: ArenaActorDef[] = input.actors.map((actor: any) => {
    const character = actor.kind === 'character';
    const monsterId = character ? null : String(actor.definitionId ?? '');
    return {
      ...common(actor),
      id: rename(String(actor.id)),
      look: character ? self.look : null,
      monsterId,
      attackStyle: character ? self.attackStyle : options.monsterStyle?.(monsterId!) ?? 'melee',
    };
  });
  const selfActor = actors.find((a) => a.kind === 'character');
  const fled = (entry as { cancellationReason?: string | null }).cancellationReason === 'flee' && Number.isFinite(ms(entry.cancelledAt));
  return {
    id: entry.id, startAtMs, endAtMs, tickMs: Number(entry.tickDurationMs) || Number(input.tickDurationMs) || 500,
    actors, events, flee: fled ? { atMs: ms(entry.cancelledAt) } : null,
    outcome: outcomeOf((entry as { outcome?: unknown }).outcome ?? log?.outcome),
    selfId: selfActor?.id ?? self.id, mapId: String((entry as { mapId?: string }).mapId ?? ''),
  };
}

export function fromSharedBattle(view: SharedBattleView, selfId: string, options: ArenaBattleOptions = {}): ArenaBattle {
  const actors: ArenaActorDef[] = view.snapshot.actors.map((actor) => {
    const character = actor.kind === 'character';
    const look = character ? arenaLook(actor.look ?? null, options) : null;
    const monsterId = character ? null : String(actor.definitionId ?? actor.monsterId ?? '');
    return {
      ...common(actor),
      look, monsterId,
      attackStyle: character ? styleOfLook(look) : options.monsterStyle?.(monsterId!) ?? 'melee',
    };
  });
  return {
    id: view.id, startAtMs: ms(view.startAt), endAtMs: ms(view.endAt), tickMs: view.snapshot.tickDurationMs ?? 500,
    actors, events: (view.log.events ?? []) as ArenaEvent[],
    flee: view.state === 'fled' ? { atMs: ms(view.endAt) } : null,
    outcome: outcomeOf((view.log as { outcome?: unknown }).outcome),
    selfId, mapId: String(view.mapId ?? ''),
  };
}

function renameEvent(e: ArenaEvent, rename: (id: string) => string): ArenaEvent {
  const states = e.actorStates ? Object.fromEntries(Object.entries(e.actorStates).map(([id, s]) => [rename(id), s.targetId ? { ...s, targetId: rename(s.targetId) } : s])) : undefined;
  return { ...e, actorId: rename(e.actorId), targetIds: e.targetIds.map(rename), ...(states ? { actorStates: states } : {}) };
}

function common(actor: any): Omit<ArenaActorDef, 'look' | 'monsterId' | 'attackStyle'> {
  const snapshot = actor.snapshot ?? {};
  const position: ArenaCell = { row: Number(actor.position?.row ?? 5), column: Number(actor.position?.column ?? 0) };
  return {
    id: String(actor.id), team: actor.team === 'b' ? 'b' : 'a',
    kind: actor.kind === 'monster' ? 'monster' : actor.kind === 'pet' ? 'pet' : 'character',
    name: String(actor.name ?? snapshot.name ?? actor.id), start: position,
    maxHp: Number(snapshot.maxHp ?? snapshot.hp ?? 0), maxSp: Number(snapshot.maxSp ?? snapshot.sp ?? 0),
    hp: Number(snapshot.hp ?? 0), sp: Number(snapshot.sp ?? 0),
    moveSpeed: Number.isFinite(Number(snapshot.moveSpeed)) ? Number(snapshot.moveSpeed) : null,
  };
}

export interface SharedActorLook {
  sex: Sex; heightCm: number; appearance: CharacterAppearance | null; dominantHand?: 'right' | 'left' | null;
  equipment?: VisibleEquipment | null; refinement?: VisibleRefinement | null;
}

/** A character's look as the API sends it (party state, shared battle) → what the arena draws. */
export function arenaLook(look: SharedActorLook | null, options: ArenaBattleOptions): ArenaCharacterLook | null {
  if (!look?.appearance) return null;
  const equipment = look.equipment ?? {};
  const hands = options.handTypes?.(equipment) ?? { main: null, off: null };
  return {
    sex: look.sex, heightCm: look.heightCm, appearance: look.appearance, dominantHand: look.dominantHand === 'left' ? 'left' : 'right',
    equipment, refinement: look.refinement ?? null, mainHandType: hands.main, offHandType: hands.off,
  };
}
