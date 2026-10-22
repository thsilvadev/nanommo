import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapKillCounter, Character, User } from '../../database/entities';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { DataModule } from '../data/data.module';
import { BattleModule } from '../battle/battle.module';
import { CharacterModule } from '../character/character.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { PresenceModule } from '../presence/presence.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WorldActivityProcessor } from './world-activity.processor';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MapKillCounter, Character, User]),
    BullModule.registerQueue({ name: 'battle-queue' }),
    DataModule,
    BattleModule,
    CharacterModule,
    EquipmentModule,
    InventoryModule,
    PresenceModule,
    ChatModule,
  ],
  controllers: [MapController],
  providers: [MapService, ...(process.env.BATTLE_QUEUE_MAINTENANCE_ONLY === 'true' ? [] : [WorldActivityProcessor])],
  exports: [MapService],
})
export class MapModule {}
