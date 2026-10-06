import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '@/database/entities';
import { Character } from '@/database/entities/character.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleOAuthController } from './google-oauth.controller';
import { GoogleOAuthService } from './google-oauth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailerModule } from '../mailer/mailer.module';
import { RedisModule } from '../../config/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Character]),
    RedisModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || 'fallback_dev_key_12345678',
      }),
      inject: [ConfigService],
    }),
    MailerModule,
    forwardRef(() => require('../character/character.module').CharacterModule),
  ],
  providers: [AuthService, GoogleOAuthService, JwtStrategy],
  controllers: [AuthController, GoogleOAuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
