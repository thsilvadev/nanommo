import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { CharacterModule } from './modules/character/character.module';
import { BattleModule } from './modules/battle/battle.module';
import { GambitModule } from './modules/gambit/gambit.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { MapModule } from './modules/map/map.module';
import { TownModule } from './modules/town/town.module';
import { MarketModule } from './modules/market/market.module';
import { MailModule } from './modules/mail/mail.module';
import { MailerModule } from './modules/mailer/mailer.module';
import { ChatModule } from './modules/chat/chat.module';
import { DataModule } from './modules/data/data.module';
import { GatewayModule } from './modules/gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
        limit: parseInt(process.env.THROTTLE_LIMIT || '60', 10),
      },
    ]),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'nanommo',
      password: process.env.DB_PASSWORD || 'nanommo_dev_password',
      database: process.env.DB_NAME || 'nanommo',
      // Schema changes are migration-driven. Running synchronize before migrations can
      // attempt NOT NULL changes before legacy rows are normalized by the migration.
      synchronize: false,
      logging: process.env.DB_LOGGING === 'true',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
      migrationsRun: true,
    }),
    PassportModule,
    AuthModule,
    CharacterModule,
    BattleModule,
    GambitModule,
    InventoryModule,
    EquipmentModule,
    MapModule,
    TownModule,
    MarketModule,
    MailModule,
    MailerModule,
    ChatModule,
    DataModule,
    GatewayModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
