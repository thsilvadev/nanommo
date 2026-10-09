import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { DevCheatController } from './dev-cheat.controller';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryItem, Character]), DataModule, forwardRef(() => CharacterModule)],
  controllers: [InventoryController, DevCheatController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
