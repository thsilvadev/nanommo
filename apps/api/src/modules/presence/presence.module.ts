import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from '../../database/entities/character.entity';
import { RedisModule } from '../../config/redis.module';
import { MapPresenceService } from './map-presence.service';
import { OnlinePresenceService } from './online-presence.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Character]),
    RedisModule,
  ],
  providers: [MapPresenceService, OnlinePresenceService],
  exports: [MapPresenceService, OnlinePresenceService],
})
export class PresenceModule {}