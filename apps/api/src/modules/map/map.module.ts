import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapKillCounter, Character, User } from '../../database/entities';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { DataModule } from '../data/data.module';
import { BattleModule } from '../battle/battle.module';
import { CharacterModule } from '../character/character.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MapKillCounter, Character, User]),
    DataModule,
    BattleModule,
    CharacterModule,
  ],
  controllers: [MapController],
  providers: [MapService],
  exports: [MapService],
})
export class MapModule {}
