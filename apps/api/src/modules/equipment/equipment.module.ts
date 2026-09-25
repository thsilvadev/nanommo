import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { EquippedItem } from '../../database/entities/equipped-item.entity';
import { Character } from '../../database/entities/character.entity';
import { WeaponProficiency } from '../../database/entities/weapon-proficiency.entity';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';

@Module({
  imports: [TypeOrmModule.forFeature([EquippedItem, Character, WeaponProficiency]), DataModule, CharacterModule],
  controllers: [EquipmentController],
  providers: [EquipmentService],
  exports: [EquipmentService],
})
export class EquipmentModule {}
