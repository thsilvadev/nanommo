import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { Character } from '../../database/entities/character.entity';
import { MapKillCounter } from '../../database/entities/map-kill-counter.entity';
import { GambitPage } from '../../database/entities/gambit-page.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { BattleController } from './battle.controller';
import { BattleService } from './battle.service';
import { BattleQueueProcessor } from './battle-queue.processor';
import { BattleRecoveryService } from './battle-recovery.service';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { RedisModule } from '../../config/redis.module';
import { GatewayService } from '../gateway/gateway.service';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BattleQueueEntry,
      Character,
      MapKillCounter,
      GambitPage,
      InventoryItem,
    ]),
    BullModule.registerQueue({
      name: 'battle-queue',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    DataModule,
    forwardRef(() => CharacterModule),
    forwardRef(() => InventoryModule),
    forwardRef(() => EquipmentModule),
    RedisModule,
    PresenceModule,
  ],
  controllers: [BattleController],
  providers: [BattleService, BattleQueueProcessor, BattleRecoveryService, GatewayService],
  exports: [BattleService, GatewayService],
})
export class BattleModule {}
