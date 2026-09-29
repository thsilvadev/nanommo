import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('equipped_items')
@Unique(['characterId', 'slot'])
@Index(['characterId'])
export class EquippedItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character?: Character;

  @Column({ type: 'enum', enum: ['head', 'body', 'mainHand', 'offHand', 'shoes', 'cape', 'accessoryLeft', 'accessoryRight'] })
  slot!: string;

  @Column({ type: 'varchar' })
  itemId!: string;

  @Column({ type: 'jsonb', nullable: true })
  instanceData?: any;
}
