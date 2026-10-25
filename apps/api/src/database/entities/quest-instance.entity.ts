import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Character } from './character.entity';

@Entity('quest_instances')
@Index(['characterId', 'status'])
@Index(['characterId', 'questId'])
export class QuestInstance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) characterId!: string;
  @ManyToOne(() => Character, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'characterId' }) character?: Character;
  @Column({ type: 'varchar' }) questId!: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status!: 'active' | 'completed' | 'abandoned' | 'expired';
  @Column({ type: 'jsonb', default: '{}' }) progress!: Record<string, number>;
  @Column({ type: 'timestamptz' }) acceptedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) expiresAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt?: Date | null;
  @CreateDateColumn() createdAt!: Date;
}
