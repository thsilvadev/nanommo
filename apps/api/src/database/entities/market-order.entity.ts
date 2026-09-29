import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('market_orders')
@Index(['characterId'])
@Index(['itemId'])
export class MarketOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character?: Character;

  @Column({ type: 'enum', enum: ['sell', 'buy'] })
  type!: 'sell' | 'buy';

  @Column({ type: 'varchar' })
  itemId!: string;

  @Column({ type: 'jsonb', nullable: true })
  itemInstanceData?: any;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'int' })
  pricePerUnit!: number;

  @Column({ type: 'int', nullable: true })
  escrowedItemQuantity?: number;

  @Column({ type: 'bigint', nullable: true })
  escrowedGold?: number;

  @Column({ type: 'enum', enum: ['active', 'fulfilled', 'cancelled', 'expired'] })
  status!: string;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;
}
