import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { forwardRef } from '@nestjs/common';
import { BattleModule } from '../battle/battle.module';
import { TownController } from './town.controller';
import { TownService } from './town.service';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [TypeOrmModule.forFeature([Character, InventoryItem]), BullModule.registerQueue({ name: 'battle-queue' }), DataModule, CharacterModule, InventoryModule, forwardRef(() => BattleModule)],
  controllers: [TownController],
  providers: [TownService],
  exports: [TownService],
})
export class TownModule {}
