import type { CombatantSnapshot } from '../battle-engine';
import type { StatusEffectDefinition } from './index';

export type ActorId = string;
export type TeamId = 'a' | 'b';
export type BattleActorKind = 'character' | 'monster' | 'pet';
export interface GridPosition { row: number; column: number }
export interface GroupGambitCondition { id?: string; type?: string; params?: Record<string, string | number>; [key: string]: string | number | Record<string, string | number> | undefined }
export interface GroupGambitAction { id?: string; type?: string; params?: Record<string, string | number>; skillId?: string; itemId?: string }
export interface GroupGambitLine { priority?: number; conditions?: GroupGambitCondition[]; condition?: GroupGambitCondition; action: GroupGambitAction }
export type GroupGambitPage = { lines: GroupGambitLine[] } | GroupGambitLine[] | null;
/** Catalog effects are data only; no executable callbacks can enter a snapshot. */
export interface CombatEffectDefinition {
  type?: string; amount?: number; hpAmount?: number; spAmount?: number;
  hpPercent?: number; spPercent?: number; flatPerRank?: number; atkMultiplier?: number;
  multiplierPerRank?: boolean; damagePerRank?: number; applyStatus?: string; status?: string;
  statusChance?: number; statusDurationTicks?: number; statusDurationTicksByRank?: number[];
  durationTicks?: number; durationSeconds?: number; targetDistance?: number;
  healPercentMaxHp?: number; healFlat?: number; absorbPerRank?: number; defBonusPerRank?: number;
  matkScaleDenominator?: number; burnChance?: number; burnIntervalTicks?: number; burnDurationTicks?: number;
  hpRegenPerTenTicks?: number; spRegenPerTenTicks?: number; defBonus?: number; mdefPercentBonus?: number;
  attackSpeedMultiplier?: number; castTimeReductionMultiplier?: number;
  [key: string]: string | number | boolean | number[] | undefined;
}
export interface CombatSkillDefinition {
  id?: string; target?: 'self' | 'ally' | 'foe'; damageType?: string; element?: string;
  ranged?: boolean; maxRange?: number; baseCastTicks?: number; spCost?: number; cooldownTicks?: number;
  masteryRank?: number; effect?: CombatEffectDefinition; effects?: CombatEffectDefinition[];
}
export interface CombatItemDefinition { id?: string; type: string; alchemyCategory?: string; cooldownInSeconds?: number; cooldownSeconds?: number; maxStack?:number; effect?: CombatEffectDefinition }
export interface BattleDefinitionsV2 { items?: Record<string, CombatItemDefinition>; skills?: Record<string, CombatSkillDefinition>; statuses?: Record<string, Partial<StatusEffectDefinition>> }
export interface BattleActor {
  id: ActorId; kind: BattleActorKind; team: TeamId; position: GridPosition;
  snapshot: CombatantSnapshot; gambits: GroupGambitPage; inventory: Record<string, number>;
  name?: string; definitionId?: string; encounterRole?: 'principal'|'raid'; orderIndex?: number; principalActorId?: ActorId;
  attackIntervalTicks?: number; damageTakenMultiplier?: Record<string, number>;
  weaponCategoryDamageTakenMultiplier?: Record<string, number>;
}
export interface BattleInputV2 { elementalRulesVersion?: 0 | 1; /** 1: the movement gauge does not bank past one step while an actor stands still (absent: legacy inputs, replayed as generated). */ movementRulesVersion?: 0 | 1; version: 2; seed: string; tickDurationMs: 500; actors: BattleActor[]; definitions: BattleDefinitionsV2; maxTicks?: number; regenTickOffset?: number }
export interface PendingCastV2 { action: GroupGambitAction; targetId: ActorId; resolvesAtTick: number; startedAtTick: number }
export interface BattleActorState extends Omit<CombatantSnapshot, 'position'> {
  id: ActorId; name: string; kind: BattleActorKind; team: TeamId; position: GridPosition;
  inventory: Record<string, number>; targetId?: ActorId;
  attackGauge: number; attackPreparationStartsAtTick?: number; castGauge: number; movementGauge: number; pendingCast: PendingCastV2 | null;
  itemsConsumed: Array<{ itemId: string; quantity: number }>;
}
export type ActorEventPayload =
  | { type:'target'; previousTargetId?: ActorId }
  | { type:'move'; from:GridPosition; to:GridPosition; reason:'approach'|'blinkstrike'|'push'|'revive' }
  | { type:'action'; cooldown?:{key:string;durationTicks:number}; skillId?:string; itemId?:string; damage?:number; damageType?:string; damageComponents?:number[]; hit?:boolean; crit?:boolean; healAmount?:number; spGain?:number; spSpent?:number; statusApplied?:string }
  | { type:'status'; statusId:string; damage?:number; sourceSkillId?:string; sourceActor?:'character'|'monster'; damageType?:string; element?:string; passiveProc?:boolean }
  | { type:'cast'; skillId:string; resolvesAtTick:number }
  | { type:'regen'; hpGain:number; spGain:number }
  | { type:'lifecycle'; reason:'damage'|'status'|'revive'|'stalemate' };
export interface BattleActorProjection { hp:number; sp:number; position:GridPosition; statusEffects:NonNullable<CombatantSnapshot['statusEffects']>; targetId?:ActorId }
export interface ActorEvent { actorStates?:Record<ActorId,BattleActorProjection>; tick: number; actorId: ActorId; targetIds: ActorId[]; action: string; payload: ActorEventPayload }
export interface BattleResultV2 { version:2; outcome:'win'|'loss'; events:ActorEvent[]; actorsAfter:Record<ActorId,BattleActorState>; durationTicks:number; ended:boolean; termination:'victory'|'defeat'|'stalemate'|'checkpoint'|'limit' }
export type PendingActionStatus = 'pending'|'applied'|'failed'|'cancelled';
export interface PendingActionDto { id:string; kind:string; status:PendingActionStatus; message?:string }
export interface PartyDto { id:string; kind:'manual'|'auto'; leaderCharacterId:string; mapId:string; revision:number; members:Array<{characterId:string;name:string;orderIndex:number;pendingLeave:boolean}> }
