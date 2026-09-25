import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/database/entities';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev_secret_key',
    });
  }

  async validate(payload: any) {
    // Validate that sessionId exists in token
    if (!payload.sessionId) {
      throw new UnauthorizedException('SESSION_INVALIDATED');
    }

    // Fetch user to validate sessionId matches
    const user = await this.userRepository.findOne({ where: { id: payload.userId } });
    if (!user || user.activeSessionId !== payload.sessionId) {
      throw new UnauthorizedException('SESSION_INVALIDATED');
    }

    return {
      userId: payload.userId,
      username: payload.username,
      sessionId: payload.sessionId,
    };
  }
}
