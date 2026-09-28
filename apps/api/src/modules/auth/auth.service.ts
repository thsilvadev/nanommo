import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@/database/entities';
import { RegisterDto, LoginDto, AuthTokenDto, ForgotPasswordDto, ResetPasswordDto } from '@nanommo/shared';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private mailerService: MailerService,
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

    // Generate tokens with sessionId
    return this.generateTokens(user.id, user.username, sessionId);
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

    // Generate new sessionId and save to user
    const sessionId = uuidv4();
    user.activeSessionId = sessionId;

    // Update last seen
    user.lastSeenAt = new Date();
    await this.userRepository.save(user);

    // Generate tokens with sessionId
    return this.generateTokens(user.id, user.username, sessionId);
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
    if (user.emailVerified) {
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

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    // Generate new token (invalidates old one)
    const verificationToken = this.generateVerificationToken();
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpiresAt = verificationTokenExpiresAt;
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
    const user = await this.userRepository.findOne({
      where: { passwordResetToken: dto.token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Check if token is expired
    if (user.passwordResetExpiresAt && user.passwordResetExpiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    // Validate new password
    if (!dto.newPassword || dto.newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    // Hash new password with argon2id (same as registration)
    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // Update password and invalidate reset token
    user.passwordHash = passwordHash;
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;

    // Invalidate active session (force re-login) - generate new sessionId
    user.activeSessionId = uuidv4();

    await this.userRepository.save(user);

    return { success: true, message: 'Password has been reset successfully' };
  }
}
