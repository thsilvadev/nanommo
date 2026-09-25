import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character, WeaponProficiency, GambitPage } from '@/database/entities';
import { CharacterService } from './character.service';
import { CharacterController } from './character.controller';
import { DataModule } from '../data/data.module';

@Module({
  imports: [TypeOrmModule.forFeature([Character, WeaponProficiency, GambitPage]), DataModule],
  providers: [CharacterService],
  controllers: [CharacterController],
  exports: [CharacterService],
})
export class CharacterModule {}
