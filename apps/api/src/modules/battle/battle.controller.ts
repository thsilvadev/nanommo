import { Controller, Get, Post, Param, UseGuards, Request, BadRequestException } from '@nestjs/common';
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

  /**
   * Resolve a completed battle (called by scheduler)
   */
  @Post(':battleId/resolve')
  async resolveBattle(@Param('battleId') battleId: string) {
    await this.battleService.resolveBattle(battleId);
    return { success: true };
  }
}
