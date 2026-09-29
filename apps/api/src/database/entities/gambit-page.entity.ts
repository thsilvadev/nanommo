import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('gambit_pages')
@Index(['characterId'])
export class GambitPage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character?: Character;

  @Column({ type: 'int' })
  slotIndex!: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  title?: string;

  @Column({ type: 'jsonb', default: '[]' })
  lines!: any[];
}
