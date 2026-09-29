import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('battle_queue_entries')
@Index(['characterId', 'sequenceIndex'])
export class BattleQueueEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character?: Character;

  @Column({ type: 'int' })
  sequenceIndex!: number;

  @Column({ type: 'varchar' })
  mapId!: string;

  @Column({ type: 'varchar' })
  monsterId!: string;

  @Column({ type: 'timestamptz' })
  startAt!: Date;

  @Column({ type: 'timestamptz' })
  endAt!: Date;

  @Column({ type: 'enum', enum: ['win', 'loss'] })
  outcome!: 'win' | 'loss';

  @Column({ type: 'jsonb' })
  log!: any;

  @Column({ type: 'bigint' })
  xpGain!: number;

  @Column({ type: 'int' })
  goldGain!: number;

  @Column({ type: 'jsonb', default: '[]' })
  drops!: any[];

  /**
   * Items the engine actually spent during the simulation (SPEC §7.3 `use_item`).
   * Stored so resolve can deduct them from the real inventory.
   */
  @Column({ type: 'jsonb', default: '[]' })
  itemsConsumed!: Array<{ itemId: string; quantity: number }>;

  @Column({ type: 'int' })
  hpAfter!: number;

  @Column({ type: 'int' })
  spAfter!: number;

  @Column({ type: 'boolean', default: false })
  resolved!: boolean;

  @Column({ type: 'varchar' })
  seedUsed!: string;
}
