import { Controller, Get, Post, Put, Delete, UseGuards, Request, Body, Param } from '@nestjs/common';
import { GambitService } from './gambit.service';
import { CharacterService } from '../character/character.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('gambits')
@UseGuards(JwtAuthGuard)
export class GambitController {
  constructor(
    private readonly gambitService: GambitService,
    private readonly characterService: CharacterService,
  ) {}

  /**
   * Get all gambit pages for the character
   */
  @Get()
  async getGambitPages(@Request() req: any) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    if (!character) {
      return [];
    }
    return this.gambitService.getGambitPages(character.id);
  }

  /**
   * Get a specific gambit page
   */
  @Get(':pageId')
  async getGambitPage(@Param('pageId') pageId: string) {
    return this.gambitService.getGambitPage(pageId);
  }

  /**
   * Create a new gambit page
   */
  @Post()
  async createGambitPage(@Request() req: any, @Body() pageData: any) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    if (!character) {
      throw new Error('Character not found');
    }
    return this.gambitService.createGambitPage(character.id, pageData);
  }

  /**
   * Update a gambit page
   */
  @Put(':pageId')
  async updateGambitPage(@Param('pageId') pageId: string, @Body() pageData: any) {
    return this.gambitService.updateGambitPage(pageId, pageData);
  }

  /**
   * Delete a gambit page
   */
  @Delete(':pageId')
  async deleteGambitPage(@Param('pageId') pageId: string) {
    await this.gambitService.deleteGambitPage(pageId);
    return { success: true };
  }

  /**
   * Activate a gambit page for the character
   */
  @Put(':pageId/activate')
  async activateGambitPage(@Request() req: any, @Param('pageId') pageId: string) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    if (!character) {
      throw new Error('Character not found');
    }
    return this.gambitService.activateGambitPage(character.id, pageId);
  }

  /**
   * Validate a gambit line
   */
  @Post('validate-line')
  async validateGambitLine(@Body() line: any) {
    return this.gambitService.validateGambitLine(line);
  }
}
