import { Injectable, BadRequestException, UnauthorizedException, Logger, Inject, forwardRef } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@/database/entities';
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
    // Validate input
    if (!dto.username || !dto.email || !dto.password || !dto.cpf) {
      throw new BadRequestException('Missing required fields');
    }

    if (dto.username.length < 3 || dto.username.length > 16) {
      throw new BadRequestException('Username must be 3-16 characters');
    }

    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: [{ username: dto.username }, { email: dto.email }],
    });

    if (existingUser) {
      throw new BadRequestException('Username or email already registered');
    }

    // Hash password using argon2id
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456, // 19 MB
      timeCost: 2,
      parallelism: 1,
    });

    // Hash CPF
    const cpfHash = this.hashCpf(dto.cpf);

    // Generate email verification token
    const verificationToken = this.generateVerificationToken();
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user
    const user = this.userRepository.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      cpfHash,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiresAt: verificationTokenExpiresAt,
    });

    await this.userRepository.save(user);

    // Send verification email (non-blocking - log error but don't fail registration)
    try {
      await this.mailerService.sendVerificationEmail(user.email, verificationToken);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${user.email}: ${(error as Error).message}`);
    }

    // Generate sessionId for first login
    const sessionId = uuidv4();
    user.activeSessionId = sessionId;
    await this.userRepository.save(user);

    // Auto-create character with username as default name
    try {
      await this.characterService.createCharacter(user.id, user.username);
      this.logger.log(`Auto-created character for user ${user.username}`);
    } catch (error) {
      this.logger.error(`Failed to auto-create character for user ${user.username}: ${(error as Error).message}`);
      // Don't fail registration if character creation fails, but log it
    }

    // Generate tokens with sessionId
    return this.generateTokens(user.id, user.username, sessionId);
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
      // Resolve FK column names from the live schema instead of assuming the
      // database uses TypeORM property names (e.g. characterId vs character_id).
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
    const user = await this.userRepository.findOne({
      where: { username: dto.username },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.emailVerified !== true) {
      throw new UnauthorizedException('Please verify your email before logging in');
    }

    // Generate new sessionId and save to user
    const sessionId = uuidv4();
    user.activeSessionId = sessionId;

    // Update last seen
    user.lastSeenAt = new Date();
    await this.userRepository.save(user);

    // Generate tokens with sessionId
    return this.generateTokens(user.id, user.username, sessionId);
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
      return this.generateTokens(user.id, user.username, user.activeSessionId);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async validateToken(token: string): Promise<{ userId: string; username: string } | null> {
    try {
      const payload = this.jwtService.verify(token);
      return payload;
    } catch {
      return null;
    }
  }

  private generateTokens(userId: string, username: string, sessionId: string): AuthTokenDto {
    const accessToken = this.jwtService.sign({
      userId,
      username,
      sessionId,
      type: 'access',
    }, { expiresIn: '15m' }); // 15 minutes

    const refreshToken = this.jwtService.sign({
      userId,
      sessionId,
      type: 'refresh',
    }, { expiresIn: '7d' }); // 7 days

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 900 seconds (access token TTL)
    };
  }

  private hashCpf(cpf: string): string {
    const pepper = process.env.CPF_PEPPER || 'default_pepper_change_in_production';
    return crypto.createHmac('sha256', pepper).update(cpf).digest('hex');
  }

  async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    // Check if token is expired
    if (user.emailVerificationTokenExpiresAt && user.emailVerificationTokenExpiresAt < new Date()) {
      throw new BadRequestException('Verification token has expired');
    }

    // Check if already verified
    if (user.emailVerified === true) {
      throw new BadRequestException('Email already verified');
    }

    // Verify email
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiresAt = null;
    await this.userRepository.save(user);

    return { success: true, message: 'Email verified successfully' };
  }

  async resendVerificationEmail(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      // Don't reveal if email exists or not for security
      return { success: true, message: 'If the email exists, a verification email has been sent' };
    }

    if (user.emailVerified === true) {
      throw new BadRequestException('Email already verified');
    }

    // Check cooldown
    if (user.lastResendVerificationAt) {
      const elapsed = Date.now() - user.lastResendVerificationAt.getTime();
      if (elapsed < this.RESEND_VERIFICATION_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((this.RESEND_VERIFICATION_COOLDOWN_MS - elapsed) / 1000);
        throw new BadRequestException(`Please wait ${remainingSeconds}s before requesting another verification email`);
      }
    }

    // Generate new token (invalidates old one)
    const verificationToken = this.generateVerificationToken();
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpiresAt = verificationTokenExpiresAt;
    user.lastResendVerificationAt = new Date();
    await this.userRepository.save(user);

    // Send verification email
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
      where: { email: dto.email },
    });

    // Always return the same generic message for security (prevents email enumeration)
    const genericMessage = 'If the email exists, we sent a password reset link';

    if (!user) {
      return { success: true, message: genericMessage };
    }

    // Generate password reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.passwordResetToken = resetToken;
    user.passwordResetExpiresAt = resetTokenExpiresAt;
    await this.userRepository.save(user);

    // Send password reset email
    try {
      await this.mailerService.sendPasswordResetEmail(user.email, resetToken);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${user.email}: ${(error as Error).message}`);
      // Still return generic message to not leak info
    }

    return { success: true, message: genericMessage };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean; message: string }> {
    // Atomic claim: only proceed if token matches AND not expired AND not already used (passwordResetToken is not null)
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
      // Check if token exists but expired to give a clearer error
      const user = await this.userRepository.findOne({
        where: { passwordResetToken: dto.token },
      });
      if (user) {
        if (user.passwordResetExpiresAt && user.passwordResetExpiresAt < new Date()) {
          throw new BadRequestException('Reset token has expired');
        }
        // Token was already used (passwordResetToken is null)
        throw new BadRequestException('Invalid or expired reset token');
      }
      throw new BadRequestException('Invalid or expired reset token');
    }

    return { success: true, message: 'Password has been reset successfully' };
  }
}
