import { forwardRef, Module } from '@nestjs/common';
import { RedisModule } from '../../config/redis.module';
import { DataModule } from '../data/data.module';
import { PresenceModule } from '../presence/presence.module';
import { ChatModule } from '../chat/chat.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MailModule } from '../mail/mail.module';
import { BattleModule } from '../battle/battle.module';
import { TownEventService } from './town-event.service';
import { TownEventGrantService } from './town-event-grant.service';

/** Smashing Spree (Quebra-Quebra) scheduled town event. */
@Module({
  imports: [RedisModule, DataModule, PresenceModule, ChatModule, InventoryModule, MailModule, forwardRef(() => BattleModule)],
  providers: [TownEventService, TownEventGrantService],
  exports: [TownEventService],
})
export class TownEventModule {}
