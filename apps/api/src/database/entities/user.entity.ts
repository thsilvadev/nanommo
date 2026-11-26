import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

@Entity('users')
@Unique(['provider', 'email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  email!: string;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ type: 'varchar', enum: ['local', 'google'], default: 'local' })
  provider!: 'local' | 'google';

  @Column({ type: 'varchar', nullable: true })
  providerId?: string;

  @Column({ type: 'varchar', nullable: true })
  emailVerificationToken?: string;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerificationTokenExpiresAt?: Date;

  @Column({ type: 'varchar', nullable: true })
  passwordResetToken?: string;

  @Column({ type: 'timestamptz', nullable: true })
  passwordResetExpiresAt?: Date;

  @Column({ type: 'varchar', nullable: true })
  activeSessionId?: string;

  /**
   * 'player' | 'gm'. Kept out of every ORM read and write (GmAccessService reads it
   * with its own query), so a deploy that lands before migration 1800800000000
   * still logs everyone in; until then nobody is a GM.
   */
  @Column({ type: 'varchar', length: 16, select: false, insert: false, update: false }) // DB default 'player'; no ORM default, or inserts would RETURNING it
  role?: 'player' | 'gm';

  @Column({ type: 'boolean', default: false })
  isMuted!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  muteExpiresAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @Column({ type: 'int', default: 0 })
  failedLoginCount!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastResendVerificationAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
