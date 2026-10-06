import { Injectable, BadRequestException, ConflictException, HttpException, HttpStatus, UnauthorizedException, Logger, Inject, forwardRef } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@/database/entities';
import { Character } from '@/database/entities/character.entity';
import { RegisterDto, LoginDto, AuthTokenDto, ForgotPasswordDto, ResetPasswordDto } from '@nanommo/shared';
import { MailerService } from '../mailer/mailer.service';
import { CharacterService } from '../character/character.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // TUNABLE: Cooldown for resend-verification in milliseconds (default 60s)
  private readonly RESEND_VERIFICATION_COOLDOWN_MS = parseInt(process.env.RESEND_VERIFICATION_COOLDOWN_MS || '60000', 10);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Character)
    private characterRepository: Repository<Character>,
    private dataSource: DataSource,
    private jwtService: JwtService,
    private mailerService: MailerService,
    @Inject(forwardRef(() => CharacterService))
    private characterService: CharacterService,
  ) {}

  private generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async register(dto: RegisterDto): Promise<AuthTokenDto> {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Missing required fields');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(dto.email)) {
      throw new BadRequestException('Invalid email format');
    }

    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email, provider: 'local' },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const verificationToken = this.generateVerificationToken();
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = this.userRepository.create({
      email: dto.email,
      passwordHash,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiresAt: verificationTokenExpiresAt,
      provider: 'local',
      providerId: null,
      emailVerified: false,
    });

    await this.userRepository.save(user);

    try {
      await this.mailerService.sendVerificationEmail(user.email, verificationToken);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${user.email}: ${(error as Error).message}`);
    }

    const sessionId = uuidv4();
    user.activeSessionId = sessionId;
    await this.userRepository.save(user);

    return this.generateTokens(user.id, sessionId);
  }

  private async getForeignKeyColumn(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    tableName: string,
    referencedTableName: string,
  ): Promise<string> {
    const table = await queryRunner.getTable(tableName);
    const foreignKey = table?.foreignKeys.find(
      (fk) => fk.referencedTableName === referencedTableName && fk.columnNames.length === 1,
    );

    if (!foreignKey) {
      throw new Error('Could not find foreign key from ' + tableName + ' to ' + referencedTableName);
    }

    return foreignKey.columnNames[0];
  }

  private quoteIdentifier(identifier: string): string {
    return '"' + identifier.replaceAll('"', '""') + '"';
  }

  async deleteAccount(userId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const characterUserColumn = await this.getForeignKeyColumn(queryRunner, 'characters', 'users');
      const characters = await queryRunner.query(
        'SELECT id FROM characters WHERE ' + this.quoteIdentifier(characterUserColumn) + ' = $1',
        [userId],
      );
      const characterIds = characters.map((row: { id: string }) => row.id);

      const chatReportTable = await queryRunner.getTable('chat_reports');
      const chatUserColumns = chatReportTable?.foreignKeys
        .filter((fk) => fk.referencedTableName === 'users' && fk.columnNames.length === 1)
        .map((fk) => fk.columnNames[0]) ?? [];

      if (chatUserColumns.length < 2) {
        throw new Error('Could not find reporter/reported user foreign keys in chat_reports');
      }

      await queryRunner.query(
        'DELETE FROM chat_reports WHERE ' +
        this.quoteIdentifier(chatUserColumns[0]) + ' = $1 OR ' +
        this.quoteIdentifier(chatUserColumns[1]) + ' = $1',
        [userId],
      );

      if (characterIds.length) {
        const placeholders = characterIds.map((_: string, i: number) => '$' + (i + 1)).join(', ');
        const tables = [
          'inventory_items',
          'equipped_items',
          'weapon_proficiencies',
          'gambit_pages',
          'map_kill_counters',
          'battle_queue_entries',
          'market_orders',
          'mail_messages',
        ];

        for (const table of tables) {
          const characterColumn = await this.getForeignKeyColumn(queryRunner, table, 'characters');
          await queryRunner.query(
            'DELETE FROM "' + table + '" WHERE ' + this.quoteIdentifier(characterColumn) +
            ' IN (' + placeholders + ')',
            characterIds,
          );
        }

        const marketDealTable = await queryRunner.getTable('market_deals');
        const dealCharacterColumns = marketDealTable?.foreignKeys
          .filter((fk) => fk.referencedTableName === 'characters' && fk.columnNames.length === 1)
          .map((fk) => fk.columnNames[0]) ?? [];

        if (dealCharacterColumns.length < 2) {
          throw new Error('Could not find buyer/seller character foreign keys in market_deals');
        }

        const offsetPlaceholders = characterIds
          .map((_: string, i: number) => '$' + (characterIds.length + i + 1))
          .join(', ');

        await queryRunner.query(
          'DELETE FROM market_deals WHERE ' +
          this.quoteIdentifier(dealCharacterColumns[0]) + ' IN (' + placeholders + ') OR ' +
          this.quoteIdentifier(dealCharacterColumns[1]) + ' IN (' + offsetPlaceholders + ')',
          [...characterIds, ...characterIds],
        );

        await queryRunner.query(
          'DELETE FROM characters WHERE id IN (' + placeholders + ')',
          characterIds,
        );
      }

      await queryRunner.query('DELETE FROM users WHERE id = $1', [userId]);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async login(dto: LoginDto): Promise<AuthTokenDto> {
    const { identifier, password } = dto;

    let user: User | null = null;

    if (identifier.includes('@')) {
      user = await this.userRepository.findOne({
        where: { email: identifier, provider: 'local' },
      });
    } else {
      const character = await this.characterRepository.findOne({
        where: { name: identifier },
        relations: ['user'],
      });
      if (character?.user) {
        user = character.user;
      }
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException('Account temporarily locked', HttpStatus.TOO_MANY_REQUESTS);
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      user.failedLoginCount = (user.failedLoginCount ?? 0) + 1;
      if (user.failedLoginCount >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.failedLoginCount = 0;
      }
      await this.userRepository.save(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    user.failedLoginCount = 0;
    user.lockedUntil = null;

    const sessionId = uuidv4();
    user.activeSessionId = sessionId;
    user.lastSeenAt = new Date();
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return this.generateTokens(user.id, sessionId);
  }

  async refresh(refreshToken: string): Promise<AuthTokenDto> {
    if (!refreshToken) throw new UnauthorizedException('Invalid refresh token');
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_SECRET || 'dev_secret_key',
      });
      if (payload.type !== 'refresh' || !payload.userId || !payload.sessionId) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const user = await this.userRepository.findOne({ where: { id: payload.userId } });
      if (!user || user.activeSessionId !== payload.sessionId) {
        throw new UnauthorizedException('SESSION_INVALIDATED');
      }
      return this.generateTokens(user.id, user.activeSessionId);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async validateToken(token: string): Promise<{ userId: string; characterId: string | null; emailVerified: boolean; sessionId: string; type: string } | null> {
    try {
      const payload = this.jwtService.verify(token);
      return payload;
    } catch {
      return null;
    }
  }

  private async generateTokens(userId: string, sessionId: string): Promise<AuthTokenDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const character = await this.characterRepository.findOne({ where: { userId } });

    const accessToken = this.jwtService.sign({
      userId,
      characterId: character?.id ?? null,
      emailVerified: user.emailVerified,
      sessionId,
      type: 'access',
    }, { expiresIn: '15m' });

    const refreshToken = this.jwtService.sign({
      userId,
      sessionId,
      type: 'refresh',
    }, { expiresIn: '7d' });

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
    };
  }

  async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    if (user.emailVerificationTokenExpiresAt && user.emailVerificationTokenExpiresAt < new Date()) {
      throw new BadRequestException('Verification token has expired');
    }

    if (user.emailVerified === true) {
      throw new BadRequestException('Email already verified');
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiresAt = null;
    await this.userRepository.save(user);

    return { success: true, message: 'Email verified successfully' };
  }

  async resendVerificationEmail(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { email, provider: 'local' },
    });

    if (!user) {
      return { success: true, message: 'If the email exists, a verification email has been sent' };
    }

    if (user.emailVerified === true) {
      throw new BadRequestException('Email already verified');
    }

    if (user.lastResendVerificationAt) {
      const elapsed = Date.now() - user.lastResendVerificationAt.getTime();
      if (elapsed < this.RESEND_VERIFICATION_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((this.RESEND_VERIFICATION_COOLDOWN_MS - elapsed) / 1000);
        throw new BadRequestException(`Please wait ${remainingSeconds}s before requesting another verification email`);
      }
    }

    const verificationToken = this.generateVerificationToken();
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpiresAt = verificationTokenExpiresAt;
    user.lastResendVerificationAt = new Date();
    await this.userRepository.save(user);

    try {
      await this.mailerService.sendVerificationEmail(user.email, verificationToken);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${user.email}: ${(error as Error).message}`);
      throw new BadRequestException('Failed to send verification email');
    }

    return { success: true, message: 'Verification email sent' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email, provider: 'local' },
    });

    const genericMessage = 'If the email exists, we sent a password reset link';

    if (!user) {
      return { success: true, message: genericMessage };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    user.passwordResetToken = resetToken;
    user.passwordResetExpiresAt = resetTokenExpiresAt;
    await this.userRepository.save(user);

    try {
      await this.mailerService.sendPasswordResetEmail(user.email, resetToken);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${user.email}: ${(error as Error).message}`);
    }

    return { success: true, message: genericMessage };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean; message: string }> {
    const claimed = await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({
        passwordHash: await argon2.hash(dto.newPassword, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        activeSessionId: uuidv4(),
      })
      .where('"passwordResetToken" = :token', { token: dto.token })
      .andWhere('"passwordResetToken" IS NOT NULL')
      .andWhere('"passwordResetExpiresAt" > :now', { now: new Date() })
      .execute();

    if (!claimed.affected) {
      const user = await this.userRepository.findOne({
        where: { passwordResetToken: dto.token },
      });
      if (user) {
        if (user.passwordResetExpiresAt && user.passwordResetExpiresAt < new Date()) {
          throw new BadRequestException('Reset token has expired');
        }
        throw new BadRequestException('Invalid or expired reset token');
      }
      throw new BadRequestException('Invalid or expired reset token');
    }

    return { success: true, message: 'Password has been reset successfully' };
  }
}