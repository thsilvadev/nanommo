import { Controller, Get, Post, UseGuards, Request, Param, BadRequestException } from '@nestjs/common';
import { MapService } from './map.service';
import { CharacterService } from '../character/character.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('maps')
@UseGuards(JwtAuthGuard)
export class MapController {
  constructor(
    private readonly mapService: MapService,
    private readonly characterService: CharacterService,
  ) {}

  /**
   * Get all available maps
   */
  @Get()
  async getMaps() {
    return this.mapService.getMaps();
  }

  /**
   * Get maps recommended for character's level
   */
  @Get('recommended')
  async getRecommendedMaps(@Request() req: any) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');
    return this.mapService.getRecommendedMaps(character.id);
  }

  /**
   * Enter a map
   */
  @Post(':mapId/enter')
  async enterMap(@Request() req: any, @Param('mapId') mapId: string) {
    // Check email verification FIRST (§15.1)
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');
    
    // Note: email verification is checked inside mapService.enterMap() before other validations
    await this.mapService.enterMap(character.id, mapId);
    return { success: true, currentMapId: mapId, character: character.id };
  }

  /**
   * Leave current map
   */
  @Post('leave')
  async leaveMap(@Request() req: any) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');
    const result = await this.mapService.leaveMap(character.id);
    return { success: true, ...result };
  }

  /**
   * Get kill counter for map
   */
  @Get(':mapId/kill-counter')
  async getKillCounter(@Request() req: any, @Param('mapId') mapId: string) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new BadRequestException('Character not found');
    return this.mapService.getKillCounter(character.id, mapId);
  }
}
