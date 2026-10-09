import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { EquippedItem } from '../../database/entities/equipped-item.entity';
import { Character } from '../../database/entities/character.entity';
import { WeaponProficiency } from '../../database/entities/weapon-proficiency.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [TypeOrmModule.forFeature([EquippedItem, Character, WeaponProficiency, InventoryItem, BattleQueueEntry]), DataModule, forwardRef(() => CharacterModule), forwardRef(() => InventoryModule)],
  controllers: [EquipmentController],
  providers: [EquipmentService],
  exports: [EquipmentService],
})
export class EquipmentModule {}
