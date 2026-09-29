import { Controller, Get, Post, Put, Delete, UseGuards, Request, Body, Param, NotFoundException } from '@nestjs/common';
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
   * The JWT carries `userId`, never `characterId` (see STATUS §1).
   */
  private async requireCharacter(req: any) {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) {
      throw new NotFoundException('Character not found');
    }
    return character;
  }

  /**
   * Get all gambit pages for the character
   */
  @Get()
  async getGambitPages(@Request() req: any) {
    const character = await this.requireCharacter(req);
    return this.gambitService.getGambitPages(character.id);
  }

  /**
   * Get a specific gambit page.
   * Scoped to the caller's character: without this, any authenticated user
   * could read another character's gambit page by guessing a pageId.
   */
  @Get(':pageId')
  async getGambitPage(@Request() req: any, @Param('pageId') pageId: string) {
    const character = await this.requireCharacter(req);
    const page = await this.gambitService.getGambitPage(pageId);
    if (!page || page.characterId !== character.id) {
      throw new NotFoundException('Gambit page not found');
    }
    return page;
  }

  /**
   * Create a new gambit page
   */
  @Post()
  async createGambitPage(@Request() req: any, @Body() pageData: any) {
    const character = await this.requireCharacter(req);
    return this.gambitService.createGambitPage(character.id, pageData);
  }

  /**
   * Update a gambit page
   */
  @Put(':pageId')
  async updateGambitPage(
    @Request() req: any,
    @Param('pageId') pageId: string,
    @Body() pageData: any,
  ) {
    const character = await this.requireCharacter(req);
    return this.gambitService.updateGambitPage(character.id, pageId, pageData);
  }

  /**
   * Delete a gambit page
   */
  @Delete(':pageId')
  async deleteGambitPage(@Request() req: any, @Param('pageId') pageId: string) {
    const character = await this.requireCharacter(req);
    await this.gambitService.deleteGambitPage(character.id, pageId);
    return { success: true };
  }

  /**
   * Activate a gambit page for the character
   */
  @Put(':pageId/activate')
  async activateGambitPage(@Request() req: any, @Param('pageId') pageId: string) {
    const character = await this.requireCharacter(req);
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
