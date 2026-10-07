import { Controller, Get, Post, Param, UseGuards, Request, BadRequestException, NotFoundException } from '@nestjs/common';
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

    let queue = await this.battleService.getBattleQueue(character.id);
    // A grinding character must never remain on a map with an empty authoritative
    // queue. Heal a transient queue gap by rebuilding the normal queue on read.
    if (
      queue.length === 0 &&
      character.status === 'grinding' &&
      character.currentMapId &&
      !character.returnToTownAfterBattle
    ) {
      await this.battleService.queueBattles(character.id, 5, false);
      queue = await this.battleService.getBattleQueue(character.id);
    }

    return queue;
  }

  @Get('history')
  async getHistory(@Request() req: any) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');
    return this.battleService.getResolvedBattleHistory(character.id);
  }

  @Get(':battleId')
  async getHistoryDetail(@Request() req: any, @Param('battleId') battleId: string) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');
    const battle = await this.battleService.getResolvedBattleDetail(character.id, battleId);
    if (!battle) throw new NotFoundException('Battle not found');
    return battle;
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
