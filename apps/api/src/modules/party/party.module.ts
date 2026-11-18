import { Module } from '@nestjs/common';
import { GambitModule } from '../gambit/gambit.module';
import { CharacterModule } from '../character/character.module';
import { BattleModule } from '../battle/battle.module';
import { DataModule } from '../data/data.module';
import { PresenceModule } from '../presence/presence.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QuestModule } from '../quests/quest.module';
import { RedisModule } from '../../config/redis.module';
import { PartyController } from './party.controller';
import { PartyService } from './party.service';
import { SharedBattleService } from './shared-battle.service';
import { PartyWorkerService } from './party-worker.service';
@Module({imports:[GambitModule,CharacterModule,BattleModule,DataModule,InventoryModule,QuestModule,RedisModule,PresenceModule],controllers:[PartyController],providers:[PartyService,SharedBattleService,PartyWorkerService],exports:[PartyService,SharedBattleService]})
export class PartyModule{}
