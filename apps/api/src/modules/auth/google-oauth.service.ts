import { Injectable, Inject, Logger, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/database/entities';
import { Character } from '@/database/entities/character.entity';
import { AuthTokenDto } from '@nanommo/shared';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { AuthService } from './auth.service';

interface OAuthState { state: string; codeVerifier: string; createdAt: number; }

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly ttlSeconds = 600;
  private readonly handoffTtlSeconds = 60;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Character) private readonly characters: Repository<Character>,
    private readonly auth: AuthService,
  ) {}

  private get clientId(): string { return this.config.get<string>('GOOGLE_CLIENT_ID') || ''; }
  private get clientSecret(): string { return this.config.get<string>('GOOGLE_CLIENT_SECRET') || ''; }
  private get callbackUrl(): string { return this.config.get<string>('GOOGLE_OAUTH_CALLBACK_URL') || ''; }
  private get frontendCallbackUrl(): string { return this.config.get<string>('GOOGLE_OAUTH_FRONTEND_CALLBACK_URL') || ''; }

  private assertConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.callbackUrl || !this.frontendCallbackUrl) {
      throw new UnauthorizedException('Google authentication is not configured');
    }
  }

  private oauthClient(): OAuth2Client { return new OAuth2Client(this.clientId, this.clientSecret, this.callbackUrl); }
  private random(size = 32): string { return crypto.randomBytes(size).toString('base64url'); }

  async begin(): Promise<string> {
    this.assertConfigured();
    const state = this.random();
    const codeVerifier = this.random(48);
    const challenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    await this.redis.setex(`oauth:google:state:${state}`, this.ttlSeconds, JSON.stringify({ state, codeVerifier, createdAt: Date.now() } satisfies OAuthState));
    return this.oauthClient().generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256' as any,
      prompt: 'select_account',
    });
  }

  async callback(code: string, state: string): Promise<string> {
    this.assertConfigured();
    if (!code || !state) throw new BadRequestException('Invalid Google OAuth callback');
    const key = `oauth:google:state:${state}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException('Google OAuth state expired or invalid');
    if (await this.redis.del(key) !== 1) throw new UnauthorizedException('Google OAuth state already used');
    const oauthState = JSON.parse(raw) as OAuthState;
    if (oauthState.state !== state || Date.now() - oauthState.createdAt > this.ttlSeconds * 1000) throw new UnauthorizedException('Google OAuth state expired or invalid');

    const client = this.oauthClient();
    const { tokens: googleTokens } = await client.getToken({ code, codeVerifier: oauthState.codeVerifier });
    if (!googleTokens.id_token) throw new UnauthorizedException('Google did not return an identity token');
    const ticket = await client.verifyIdToken({ idToken: googleTokens.id_token, audience: this.clientId });
    const payload = ticket.getPayload();
    if (!payload || payload.iss !== 'https://accounts.google.com' || !payload.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException('Google identity could not be verified');
    }

    const email = payload.email.toLowerCase();
    let user = await this.users.findOne({ where: { provider: 'google', providerId: payload.sub } });
    if (!user) {
      const local = await this.users.findOne({ where: { provider: 'local', email } });
      if (local) throw new ConflictException('This email is already registered with a local account. Please sign in with email and password.');
      user = this.users.create({
        email, passwordHash: null, provider: 'google', providerId: payload.sub,
        emailVerified: true, activeSessionId: null, failedLoginCount: 0, lockedUntil: null,
        lastLoginAt: new Date(), lastSeenAt: new Date(),
      });
      await this.users.save(user);
    } else {
      user.email = email; user.emailVerified = true; user.lastLoginAt = new Date(); user.lastSeenAt = new Date();
    }

    const sessionId = uuidv4();
    user.activeSessionId = sessionId;
    await this.users.save(user);
    const tokens = await this.auth.generateTokensForUser(user.id, sessionId);
    const handoff = this.random();
    await this.redis.setex(`oauth:google:handoff:${handoff}`, this.handoffTtlSeconds, JSON.stringify({ tokens, createdAt: Date.now() }));
    return handoff;
  }

  async redeem(handoff: string): Promise<AuthTokenDto> {
    if (!handoff) throw new BadRequestException('Google OAuth handoff is required');
    const key = `oauth:google:handoff:${handoff}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException('Google OAuth handoff expired or invalid');
    if (await this.redis.del(key) !== 1) throw new UnauthorizedException('Google OAuth handoff already used');
    const value = JSON.parse(raw) as { tokens: AuthTokenDto; createdAt: number };
    if (Date.now() - value.createdAt > this.handoffTtlSeconds * 1000) throw new UnauthorizedException('Google OAuth handoff expired');
    return value.tokens;
  }

  frontendUrl(handoff: string): string {
    this.assertConfigured();
    const url = new URL(this.frontendCallbackUrl);
    url.searchParams.set('code', handoff);
    return url.toString();
  }
}
