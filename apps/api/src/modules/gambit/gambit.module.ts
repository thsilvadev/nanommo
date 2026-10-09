import { Module, forwardRef } from '@nestjs/common';
import { BattleModule } from '../battle/battle.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GambitController } from './gambit.controller';
import { GambitService } from './gambit.service';
import { GambitPage } from '../../database/entities/gambit-page.entity';
import { Character } from '../../database/entities/character.entity';
import { DataModule } from '../data/data.module';
import { CharacterModule } from '../character/character.module';

@Module({
  imports: [TypeOrmModule.forFeature([GambitPage, Character]), DataModule, CharacterModule, forwardRef(() => BattleModule)],
  controllers: [GambitController],
  providers: [GambitService],
  exports: [GambitService],
})
export class GambitModule {}
