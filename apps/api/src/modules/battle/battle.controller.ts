import { Controller, Get, Post, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { BattleService } from './battle.service';
import { CharacterService } from '../character/character.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('battles')
@UseGuards(JwtAuthGuard)
export class BattleController {
  constructor(
    private readonly battleService: BattleService,
    private readonly characterService: CharacterService,
  ) {}

  /**
   * Get battle queue for authenticated user's character
   */
  @Get('queue')
  async getQueue(@Request() req: any) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');

    return this.battleService.getBattleQueue(character.id);
  }

  /**
   * Queue battles for the character (fill up to target depth)
   */
  @Post('queue')
  async queueBattles(@Request() req: any) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');

    return this.battleService.queueBattles(character.id, 5);
  }

  // SPEC §7.4.3: resolving an entry is a BullMQ delayed job's job, not an API
  // route. This endpoint used to be `POST /battles/:battleId/resolve` with no
  // ownership check, so any authenticated user could force-resolve another
  // character's battle (and grant themselves the XP/gold/drops). It is removed:
  // `BattleService.resolveBattle()` is now reachable only from
  // `BattleQueueProcessor` and the §7.5 boot recovery pass.
}
