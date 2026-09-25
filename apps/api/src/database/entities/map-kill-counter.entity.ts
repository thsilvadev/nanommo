import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('map_kill_counters')
@Unique(['characterId', 'mapId'])
@Index(['characterId'])
export class MapKillCounter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character)
  @JoinColumn({ name: 'characterId' })
  character?: Character;

  @Column({ type: 'varchar' })
  mapId!: string;

  @Column({ type: 'int', default: 0 })
  epoch!: number;

  @Column({ type: 'int', default: 0 })
  mapKillCount!: number;

  @Column({ type: 'jsonb', default: '{}' })
  perMonsterKillCount!: Record<string, number>;
}
