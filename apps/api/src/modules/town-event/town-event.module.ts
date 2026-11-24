import { Module } from '@nestjs/common';
import { RedisModule } from '../../config/redis.module';
import { DataModule } from '../data/data.module';
import { PresenceModule } from '../presence/presence.module';
import { ChatModule } from '../chat/chat.module';
import { TownEventService } from './town-event.service';
import { TownEventGrantService } from './town-event-grant.service';

/** Smashing Spree (Quebra-Quebra) scheduled town event. */
@Module({
  imports: [RedisModule, DataModule, PresenceModule, ChatModule],
  providers: [TownEventService, TownEventGrantService],
  exports: [TownEventService],
})
export class TownEventModule {}
