import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@/database/entities';
import { RegisterDto, LoginDto, AuthTokenDto } from '@nanommo/shared';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

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

    // Create user
    const user = this.userRepository.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      cpfHash,
    });

    await this.userRepository.save(user);

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
}
