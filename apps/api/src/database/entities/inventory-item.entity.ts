import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('inventory_items')
@Unique(['characterId', 'location', 'slotIndex'])
@Index(['characterId'])
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character)
  @JoinColumn({ name: 'characterId' })
  character?: Character;

  @Column({ type: 'enum', enum: ['inventory', 'warehouse'] })
  location!: 'inventory' | 'warehouse';

  @Column({ type: 'int' })
  slotIndex!: number;

  @Column({ type: 'varchar' })
  itemId!: string;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column({ type: 'jsonb', nullable: true })
  instanceData?: any;
}
