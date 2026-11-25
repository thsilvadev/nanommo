/**
 * Battle arena types. No three.js here: the projection (positions, actions,
 * phases) is pure and unit-tested without WebGL; only arena-runtime draws.
 *
 * Team-agnostic on purpose (team a vs team b, not "party vs monsters") so
 * PvP can reuse the arena.
 */
import type { CharacterAppearance, HandWeaponType, Sex, VisibleEquipment, VisibleRefinement } from '@nanommo/shared';
import type { AttackStyle } from '../../../shared/character-animation/animation-state';

export type ArenaTeam = 'a' | 'b';
export interface ArenaCell { row: number; column: number }

/** What a character looks like in the arena (the Character Summary portrait inputs). */
export interface ArenaCharacterLook {
  sex: Sex; heightCm: number; appearance: CharacterAppearance; dominantHand: 'right' | 'left';
  equipment: VisibleEquipment; refinement: VisibleRefinement | null;
  mainHandType: HandWeaponType | null; offHandType: HandWeaponType | null;
}

export interface ArenaActorDef {
  id: string; team: ArenaTeam; kind: 'character' | 'monster' | 'pet'; name: string;
  /** Deployment cell at the battle start. */
  start: ArenaCell;
  maxHp: number; maxSp: number; hp: number; sp: number;
  monsterId: string | null;
  /** null: no look known (draw a placeholder). */
  look: ArenaCharacterLook | null;
  attackStyle: AttackStyle;
  moveSpeed: number | null;
}

/** A V2 engine ActorEvent as it crosses the API (solo `log.v2Events`, shared battle `log.events`). */
export interface ArenaEvent {
  tick: number; actorId: string; targetIds: string[]; action: string;
  payload: Record<string, any>;
  actorStates?: Record<string, { hp: number; sp: number; position?: ArenaCell; targetId?: string; statusEffects?: Array<{ id?: string; type?: string }> }>;
}

export interface ArenaBattle {
  id: string; startAtMs: number; endAtMs: number; tickMs: number;
  actors: ArenaActorDef[]; events: ArenaEvent[];
  /** The party fled at `atMs` (solo: the entry's flee cancellation; party: a fled shared battle's end). */
  flee: { atMs: number } | null;
  outcome: 'win' | 'loss' | null;
  /** The viewing player's actor id. */
  selfId: string; mapId: string;
  /** Party battles: when this client first saw it (they are not known in advance). */
  receivedAtMs?: number;
}

/** Resolves hand item types from visible equipment (the client's item catalogue). */
export type HandTypesResolver = (equipment: VisibleEquipment) => { main: HandWeaponType | null; off: HandWeaponType | null };
export interface ArenaBattleOptions {
  /** Attack style of a monster species (bow monsters shoot early). Default melee. */
  monsterStyle?: (monsterId: string) => AttackStyle;
  handTypes?: HandTypesResolver;
}
