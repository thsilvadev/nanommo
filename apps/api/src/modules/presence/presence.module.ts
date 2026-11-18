import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from '../../database/entities/character.entity';
import { RedisModule } from '../../config/redis.module';
import { MapPresenceService } from './map-presence.service';
import { OnlinePresenceService } from './online-presence.service';
import { TownRosterService } from './town-roster.service';
import { DataModule } from '../data/data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Character]),
    RedisModule,
    DataModule,
  ],
  providers: [MapPresenceService, OnlinePresenceService, TownRosterService],
  exports: [MapPresenceService, OnlinePresenceService, TownRosterService],
})
export class PresenceModule {}