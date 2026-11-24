import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { QuestInstance } from '../../database/entities/quest-instance.entity';
import { DataModule } from '../data/data.module';
import { RedisModule } from '../../config/redis.module';
import { QuestController } from './quest.controller';
import { QuestService } from './quest.service';

@Module({ imports: [TypeOrmModule.forFeature([Character, InventoryItem, QuestInstance]), DataModule, RedisModule], controllers: [QuestController], providers: [QuestService], exports: [QuestService] })
export class QuestModule {}
