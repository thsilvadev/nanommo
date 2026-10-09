import { Module, forwardRef } from '@nestjs/common';
import { BattleModule } from '../battle/battle.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character, WeaponProficiency, GambitPage, EquippedItem, InventoryItem } from '@/database/entities';
import { User } from '@/database/entities/user.entity';
import { CharacterService } from './character.service';
import { CharacterController } from './character.controller';
import { DataModule } from '../data/data.module';

@Module({
  imports: [TypeOrmModule.forFeature([Character, WeaponProficiency, GambitPage, EquippedItem, InventoryItem, User]), DataModule, forwardRef(() => require('../auth/auth.module').AuthModule), forwardRef(() => BattleModule)],
  providers: [CharacterService],
  controllers: [CharacterController],
  exports: [CharacterService],
})
export class CharacterModule {}
