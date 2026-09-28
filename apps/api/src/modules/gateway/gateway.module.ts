import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { NanommoGateway } from './nanommo.gateway';
import { GatewayService } from './gateway.service';
import { Character } from '../../database/entities/character.entity';
import { User } from '../../database/entities/user.entity';
import { DataModule } from '../data/data.module';
import { RedisModule } from '../../config/redis.module';
import { BattleModule } from '../battle/battle.module';
import { MapModule } from '../map/map.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Character, User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev_secret_key_change_in_production',
      signOptions: { expiresIn: '7d' },
    }),
    DataModule,
    RedisModule,
    BattleModule,
    MapModule,
  ],
  providers: [NanommoGateway],
  exports: [NanommoGateway],
})
export class GatewayModule {}
