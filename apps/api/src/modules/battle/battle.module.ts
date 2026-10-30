import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { Character } from '../../database/entities/character.entity';
import { MapKillCounter } from '../../database/entities/map-kill-counter.entity';
import { GambitPage } from '../../database/entities/gambit-page.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { WeaponProficiency } from '../../database/entities/weapon-proficiency.entity';
import { BattleController } from './battle.controller';
import { BattleService } from './battle.service';
import { BattleQueueProcessor } from './battle-queue.processor';
import { BattleRecoveryService } from './battle-recovery.service';
import { BattleQueueGateService } from './battle-queue-gate.service';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { RedisModule } from '../../config/redis.module';
import { GatewayService } from '../gateway/gateway.service';
import { PresenceModule } from '../presence/presence.module';
import { ChatModule } from '../chat/chat.module';
import { QuestModule } from '../quests/quest.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BattleQueueEntry,
      Character,
      MapKillCounter,
      GambitPage,
      InventoryItem,
      WeaponProficiency,
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
    ChatModule,
    QuestModule,
    NotificationsModule,
  ],
  controllers: [BattleController],
  // Maintenance-only Nest context never registers Bull consumers. The recovery
  // service still runs after migrations, but no delayed job can execute in that process.
  providers: [BattleService, ...(process.env.BATTLE_QUEUE_MAINTENANCE_ONLY === 'true' ? [] : [BattleQueueProcessor]), BattleRecoveryService, BattleQueueGateService, GatewayService],
  exports: [BattleService, GatewayService, BattleQueueGateService],
})
export class BattleModule {}
