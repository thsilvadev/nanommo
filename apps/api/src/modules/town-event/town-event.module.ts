import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RedisModule } from '../../config/redis.module';
import { DataModule } from '../data/data.module';
import { PresenceModule } from '../presence/presence.module';
import { ChatModule } from '../chat/chat.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MailModule } from '../mail/mail.module';
import { BattleModule } from '../battle/battle.module';
import { TownEventService } from './town-event.service';
import { TownEventGrantService } from './town-event-grant.service';
import { TownEventProcessor, TownEventScheduler } from './town-event.processor';
import { SmashingSpreeGmEvent } from './smashing-spree.gm-event';

/** Maintenance contexts (migrations, queue reconciliation) never consume or schedule the tick. */
const MAINTENANCE_ONLY = process.env.BATTLE_QUEUE_MAINTENANCE_ONLY === 'true';

/** Smashing Spree (Quebra-Quebra) scheduled town event. */
@Module({
  imports: [BullModule.registerQueue({ name: 'town-event' }), RedisModule, DataModule, PresenceModule, ChatModule, InventoryModule, MailModule, forwardRef(() => BattleModule)],
  providers: [TownEventService, TownEventGrantService, SmashingSpreeGmEvent, ...(MAINTENANCE_ONLY ? [] : [TownEventScheduler, TownEventProcessor])],
  exports: [TownEventService, SmashingSpreeGmEvent],
})
export class TownEventModule {}
