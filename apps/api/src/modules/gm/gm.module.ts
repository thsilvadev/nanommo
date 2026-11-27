import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from '../../database/entities';
import { CharacterModule } from '../character/character.module';
import { DataModule } from '../data/data.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SmashingSpreeGmEvent } from '../town-event/smashing-spree.gm-event';
import { TownEventModule } from '../town-event/town-event.module';
import { GrantEquipCommand, GrantFoodsCommand, ResetDietCommand, UpgradeDietCommand } from './commands/inventory-cheat.commands';
import { ResetSkillTreeCommand } from './commands/reset-skilltree.command';
import { StartEventCommand } from './commands/start-event.command';
import { GmTeleportModeModule } from './gm-teleport-mode.module';
import { TeleportCommand } from './commands/teleport.command';
import { GmService } from './gm.service';
import { GM_COMMANDS, GM_EVENTS } from './gm.types';

/** Every GM command; a new one is a class in ./commands added here (and its module to `imports`). */
const GM_COMMAND_CLASSES = [TeleportCommand, StartEventCommand, GrantEquipCommand, GrantFoodsCommand, ResetDietCommand, UpgradeDietCommand, ResetSkillTreeCommand];
/** Every event `/start-event` can start; each comes from its own module. */
const GM_EVENT_CLASSES = [SmashingSpreeGmEvent];

/** GM (game master) commands typed in chat by accounts with role 'gm'. */
@Module({
  imports: [GmTeleportModeModule, TypeOrmModule.forFeature([Character]), DataModule, CharacterModule, InventoryModule, TownEventModule],
  providers: [
    GmService,
    ...GM_COMMAND_CLASSES,
    { provide: GM_COMMANDS, useFactory: (...commands: unknown[]) => commands, inject: GM_COMMAND_CLASSES },
    { provide: GM_EVENTS, useFactory: (...events: unknown[]) => events, inject: GM_EVENT_CLASSES },
  ],
  exports: [GmService],
})
export class GmModule {}
