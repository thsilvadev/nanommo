import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from '../../database/entities/character.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuestService } from './quest.service';

@Controller('quests')
@UseGuards(JwtAuthGuard)
export class QuestController {
  constructor(private readonly quests: QuestService, @InjectRepository(Character) private readonly characters: Repository<Character>) {}
  private async characterId(req: any): Promise<string> { const character = await this.characters.findOne({ where: { userId: req.user.userId } }); if (!character) throw new NotFoundException('Character not found'); return character.id; }
  @Get() async state(@Request() req: any) { return this.quests.getState(await this.characterId(req)); }
  @Get('available') async available(@Request() req: any, @Query('npcId') npcId?: string) { return this.quests.getAvailable(await this.characterId(req), npcId); }
  @Get('npc/:npcId/interaction') async npcInteraction(@Request() req: any, @Param('npcId') npcId: string) { return this.quests.getNpcInteraction(await this.characterId(req), npcId); }
  @Get(':questId/offer') async offer(@Request() req: any, @Param('questId') questId: string) { return this.quests.getOffer(await this.characterId(req), questId); }
  @Post(':questId/offer') async advanceOffer(@Request() req: any, @Param('questId') questId: string, @Body() body?: { choiceId?: string }) { return this.quests.advanceOffer(await this.characterId(req), questId, body?.choiceId); }
  @Post(':instanceId/abandon') async abandon(@Request() req: any, @Param('instanceId') instanceId: string) { await this.quests.abandon(await this.characterId(req), instanceId); return { abandoned: true }; }
  @Post(':instanceId/turn-in') async turnIn(@Request() req: any, @Param('instanceId') instanceId: string) { return this.quests.turnIn(await this.characterId(req), instanceId); }
  @Post(':instanceId/action') async action(@Request() req: any, @Param('instanceId') instanceId: string, @Body() body: { npcId?: string; objectiveId?: string }) {
    if (!body?.npcId || !body?.objectiveId) throw new BadRequestException('npcId and objectiveId are required');
    return this.quests.completeNpcAction(await this.characterId(req), instanceId, body.npcId, body.objectiveId);
  }
}
