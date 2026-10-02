import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, VersionColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { User } from './user.entity';

@Entity('characters')
@Index(['userId'])
@Unique(['userId'])
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

  @Column({ type: 'int', default: 5 })
  sor!: number;

  @Column({ type: 'numeric', precision: 15, scale: 0, default: 0 })
  gold!: number;

  @Column({ type: 'int' })
  hpCurrent!: number;

  @Column({ type: 'int' })
  spCurrent!: number;

  @Column({ type: 'varchar', nullable: true })
  currentMapId?: string;

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

  /** A requested Town return waits for the current battle to resolve. */
  @Column({ type: 'boolean', default: false })
  returnToTownAfterBattle!: boolean;

  /** Stable origin for the character's continuous 10-tick regeneration timeline. */
  @Column({ type: 'timestamptz', nullable: true })
  regenAnchorAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @VersionColumn({ default: 1 })
  stateVersion!: number;
}
