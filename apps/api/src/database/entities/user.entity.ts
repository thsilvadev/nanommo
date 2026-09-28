import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToOne, Unique, Index } from 'typeorm';

@Entity('users')
@Unique(['username'])
@Unique(['email'])
@Unique(['cpfHash'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  username!: string;

  @Column({ type: 'varchar' })
  email!: string;

  @Column({ type: 'varchar' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 64 })
  cpfHash!: string;

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

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

  @Column({ type: 'boolean', default: false })
  isMuted!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  muteExpiresAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastResendVerificationAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
