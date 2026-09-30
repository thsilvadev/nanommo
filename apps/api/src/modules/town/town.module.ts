import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TownController } from './town.controller';
import { TownService } from './town.service';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';

@Module({
  imports: [TypeOrmModule.forFeature([Character, InventoryItem]), DataModule, CharacterModule],
  controllers: [TownController],
  providers: [TownService],
  exports: [TownService],
})
export class TownModule {}
