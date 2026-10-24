import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('mail_messages')
@Index(['recipientCharacterId'])
@Index('IDX_mail_messages_senderCharacterId', ['senderCharacterId'])
@Index('IDX_mail_messages_sourceKey_unique', ['sourceKey'], { unique: true })
export class MailMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  recipientCharacterId!: string;

  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipientCharacterId' })
  recipientCharacter?: Character;

  @Column({ type: 'uuid', nullable: true })
  senderCharacterId?: string | null;

  @ManyToOne(() => Character, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'senderCharacterId', foreignKeyConstraintName: 'FK_mail_messages_senderCharacterId' })
  senderCharacter?: Character | null;

  @Column({ type: 'varchar', length: 16, default: 'Auction House' })
  senderName!: string;

  @Column({ type: 'varchar', length: 16, default: '' })
  recipientName!: string;

  @Column({ type: 'varchar', nullable: true })
  itemId?: string;

  @Column({ type: 'jsonb', nullable: true })
  itemInstanceData?: any;

  @Column({ type: 'int', nullable: true })
  quantity?: number;

  @Column({ type: 'bigint', nullable: true })
  attachedGold?: number;

  @Column({ type: 'varchar', length: 120 })
  subject!: string;

  @Column({ type: 'text', default: '' })
  body!: string;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** Legacy flag retained for rolling compatibility; new code uses independent flags below. */
  @Column({ type: 'boolean', default: false })
  collected!: boolean;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  @Column({ type: 'boolean', default: false })
  attachmentsCollected!: boolean;

  @Column({ type: 'boolean', default: false })
  senderDeleted!: boolean;

  @Column({ type: 'boolean', default: false })
  recipientDeleted!: boolean;

  @Column({ type: 'varchar', nullable: true })
  sourceKey?: string | null;
}
