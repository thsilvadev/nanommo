import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { MarketOrder } from '../../database/entities/market-order.entity';
import { MarketDeal } from '../../database/entities/market-deal.entity';
import { MailMessage } from '../../database/entities/mail-message.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataModule } from '../data/data.module';
import { GatewayModule } from '../gateway/gateway.module';
import { BattleModule } from '../battle/battle.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketOrder,
      MarketDeal,
      InventoryItem,
      Character,
    ]),
    DataModule,
    GatewayModule,
    BattleModule,
    MailModule,
    NotificationsModule,
  ],
  controllers: [MarketController],
  providers: [MarketService],
  exports: [MarketService],
})
export class MarketModule {}
