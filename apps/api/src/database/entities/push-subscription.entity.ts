import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Character } from './character.entity';

@Entity('push_subscriptions')
@Index(['characterId'])
@Index('IDX_push_subscriptions_endpoint_unique', ['endpoint'], { unique: true })
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) characterId!: string;
  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' }) character?: Character;
  @Column({ type: 'text' }) endpoint!: string;
  @Column({ type: 'text' }) p256dh!: string;
  @Column({ type: 'text' }) auth!: string;
  @Column({ type: 'varchar', length: 8, default: 'en-US' }) locale!: 'pt-BR' | 'en-US';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
