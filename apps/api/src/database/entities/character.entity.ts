import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, VersionColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { User } from './user.entity';
import { PendingMapTransition } from '@nanommo/shared';

@Entity('characters')
@Index(['userId'])
@Unique(['userId'])
@Unique(['name'])
export class Character {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: 16 })
  name!: string;

  @Column({ type: 'varchar', length: 5, default: 'right' })
  dominantHand!: 'right' | 'left';

  /** Catalogue IDs known to this character for Gambit configuration. */
  @Column({ type: 'jsonb', default: '[]' })
  knownItemIds!: string[];

  @Column({ type: 'int', default: 1 })
  level!: number;

  @Column({ type: 'bigint', default: 0 })
  xp!: number;

  @Column({ type: 'int', default: 0 })
  unspentAttributePoints!: number;

  @Column({ type: 'int', default: 5 })
  str!: number;

  @Column({ type: 'int', default: 5 })
  agi!: number;

  @Column({ type: 'int', default: 5 })
  dex!: number;

  @Column({ type: 'int', default: 5 })
  vit!: number;

  @Column({ type: 'int', default: 5 })
  int!: number;

  @Column({ name: 'luk', type: 'int', default: 5 })
  luk!: number;

  @Column({ type: 'numeric', precision: 15, scale: 0, default: 0 })
  gold!: number;

  @Column({ name: 'soul_tokens', type: 'int', default: 1000 })
  soulTokens!: number;

  @Column({ type: 'int' })
  hpCurrent!: number;

  @Column({ type: 'int' })
  spCurrent!: number;

  @Column({ type: 'varchar', default: 'map_town' })
  currentMapId!: string;

  /** Last Town map explicitly saved as this character's waypoint. */
  @Column({ type: 'varchar', nullable: true, default: 'map_town' })
  savedTownMapId?: string | null;

  /** Last user-selected stationary stance. Traveling is derived from travelIntent. */
  @Column({ type: 'varchar', length: 16, default: 'hunting' })
  lastGrindStance!: 'hunting' | 'gathering';

  /** Server-authoritative route/teleport intent; never a client-owned progress value. */
  @Column({ type: 'jsonb', nullable: true })
  travelIntent?: any | null;

  @Column({ type: 'int', default: 1 })
  gatheringLevel!: number;

  /** Cumulative server-authoritative Gathering XP; every 100 XP grants one level. */
  @Column({ type: 'int', default: 0 })
  gatheringXp!: number;

  /** Cumulative server-authoritative Cooking progression. */
  @Column({ name: 'cooking_level', type: 'int', default: 1 })
  cookingLevel!: number;

  @Column({ name: 'cooking_xp', type: 'bigint', default: 0 })
  cookingXp!: number;

  /** Persisted timed Cooking session and reservation snapshot, if any. */
  @Column({ name: 'cooking_session', type: 'jsonb', nullable: true })
  cookingSession?: any | null;

  @Column({ name: 'alchemy_level', type: 'int', default: 1 })
  alchemyLevel!: number;

  @Column({ name: 'alchemy_xp', type: 'bigint', default: 0 })
  alchemyXp!: number;

  @Column({ name: 'blacksmith_level', type: 'int', default: 1 })
  blacksmithLevel!: number;

  @Column({ name: 'blacksmith_xp', type: 'bigint', default: 0 })
  blacksmithXp!: number;

  @Column({ name: 'crafting_session', type: 'jsonb', nullable: true })
  craftingSession?: any | null;

  /** Persisted fractional Gathering cycle progress and deterministic per-cycle variance. */
  @Column({ type: 'jsonb', default: '{"progress":0,"cycleIndex":0,"varianceSeconds":null,"lastUpdatedAt":null}' })
  gatheringCycle!: any;

  /** Deterministic encounter-search cycle identity/deadline for offline catch-up. */
  @Column({ type: 'jsonb', default: '{"cycleIndex":0,"nextAt":null}' })
  encounterCycle!: any;

  @Column({ type: 'int', default: 0 })
  fleeAttemptIndex!: number;

  @Column({ type: 'timestamptz', nullable: true })
  fleeNextAttemptAt?: Date | null;

  @Column({ type: 'jsonb', default: '[\"map_town\"]' })
  discoveredMapIds!: string[];

  @Column({ type: 'enum', enum: ['town', 'grinding', 'dead_pending_return'], default: 'town' })
  status!: string;

  @Column({ type: 'uuid', nullable: true })
  activeGambitPageId?: string;

  @Column({ type: 'jsonb', nullable: true })
  lastDeathLog?: any;

  @Column({ type: 'jsonb', nullable: true })
  activeFoodBuff?: any;

  @Column({ type: 'jsonb', default: '[]' })
  diet!: Array<{ itemId: string; consumedAt: string; digestUntil: string; dietLevel: number }>;

  @Column({ type: 'jsonb', default: '{}' })
  dietLevels!: Record<string, { level: number; lastDigestUntil: string }>;

  @Column({ type: 'boolean', default: false })
  autoFeed!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  pendingEquipmentChanges?: Record<string, { itemId: string; instanceData?: any } | null>;

  @Column({ type: 'jsonb', default: '[]' })
  activeTempBuffs!: any[];

  @Column({ type: 'jsonb', default: '[]' })
  statusEffects!: any[];

  @Column({ type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  pendingMapTransition?: PendingMapTransition | null;

  /** Stable origin for the character's continuous 10-tick regeneration timeline. */
  @Column({ type: 'timestamptz', nullable: true })
  regenAnchorAt?: Date;

  /** Last globally aligned 10-tick boundary accounted for by off-battle regeneration. */
  @Column({ type: 'timestamptz', nullable: true })
  resourceRegenAt?: Date | null;

  /** Server-owned in-progress quest-offer dialogue step by quest ID. */
  @Column({ type: 'jsonb', default: '{}' })
  questOfferProgress!: Record<string, { stepIndex: number; nodeId?: string; startedAt: string }>;

  /** Absolute expiration timestamps, keyed exactly like battle-engine cooldown keys. */
  @Column({ type: 'jsonb', default: '{}' })
  consumableCooldowns!: Record<string, string>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @VersionColumn({ default: 1 })
  stateVersion!: number;
}
