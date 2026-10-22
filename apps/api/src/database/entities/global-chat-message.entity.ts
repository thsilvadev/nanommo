import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('global_chat_messages')
@Index('IDX_global_chat_messages_sent_at', ['sentAt', 'id'])
export class GlobalChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sender_character_id', type: 'uuid', nullable: true })
  senderCharacterId!: string | null;

  @ManyToOne(() => Character, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sender_character_id' })
  senderCharacter?: Character | null;

  @Column({ name: 'sender_name_snapshot', type: 'varchar', length: 16 })
  senderNameSnapshot!: string;

  @Column({ type: 'varchar', length: 200 })
  message!: string;

  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  sentAt!: Date;
}
