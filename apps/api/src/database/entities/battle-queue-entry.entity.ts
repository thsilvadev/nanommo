import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('battle_queue_entries')
@Index(['characterId', 'sequenceIndex'])
export class BattleQueueEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character)
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

  @Column({ type: 'int' })
  hpAfter!: number;

  @Column({ type: 'int' })
  spAfter!: number;

  @Column({ type: 'boolean', default: false })
  resolved!: boolean;

  @Column({ type: 'varchar' })
  seedUsed!: string;
}
