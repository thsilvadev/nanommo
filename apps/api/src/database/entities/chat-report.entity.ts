import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';

@Entity('chat_reports')
@Index(['reporterUserId'])
@Index(['reportedUserId'])
export class ChatReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reporterUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporterUserId' })
  reporterUser?: User;

  @Column({ type: 'uuid' })
  reportedUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reportedUserId' })
  reportedUser?: User;

  @Column({ type: 'varchar', length: 200 })
  messageSnapshot!: string;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;
}
