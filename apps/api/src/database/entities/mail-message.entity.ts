import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('mail_messages')
@Index(['recipientCharacterId'])
export class MailMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  recipientCharacterId!: string;

  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipientCharacterId' })
  recipientCharacter?: Character;

  @Column({ type: 'varchar', nullable: true })
  itemId?: string;

  @Column({ type: 'jsonb', nullable: true })
  itemInstanceData?: any;

  @Column({ type: 'int', nullable: true })
  quantity?: number;

  @Column({ type: 'varchar' })
  subject!: string;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'boolean', default: false })
  collected!: boolean;
}
