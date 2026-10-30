import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from '../../database/entities/character.entity';
import { PushSubscription } from '../../database/entities/push-subscription.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
@Module({ imports: [TypeOrmModule.forFeature([Character, PushSubscription])], controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
