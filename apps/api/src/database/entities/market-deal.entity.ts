import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('market_deals')
@Index(['buyerCharacterId'])
@Index(['sellerCharacterId'])
export class MarketDeal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  buyerCharacterId!: string;

  @ManyToOne(() => Character)
  @JoinColumn({ name: 'buyerCharacterId' })
  buyerCharacter?: Character;

  @Column({ type: 'uuid' })
  sellerCharacterId!: string;

  @ManyToOne(() => Character)
  @JoinColumn({ name: 'sellerCharacterId' })
  sellerCharacter?: Character;

  @Column({ type: 'varchar' })
  itemId!: string;

  @Column({ type: 'jsonb', nullable: true })
  itemInstanceData?: any;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'int' })
  pricePerUnit!: number;

  @Column({ type: 'bigint' })
  feeCollected!: number;

  @Column({ type: 'timestamptz' })
  dealAt!: Date;
}
