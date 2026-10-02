import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request as ExpressRequest } from 'express';
import { CharacterService } from './character.service';
import { CreateCharacterDto, CharacterDto, SpendAttributePointsDto, SetAutoFeedDto } from '@nanommo/shared';

@Controller('characters')
export class CharacterController {
  constructor(private characterService: CharacterService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(@Request() req: ExpressRequest, @Body() dto: CreateCharacterDto): Promise<CharacterDto> {
    return this.characterService.createCharacter((req.user as any).userId, dto.username);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getMyCharacter(@Request() req: ExpressRequest): Promise<CharacterDto | null> {
    return this.characterService.getCharacterDtoByUserId((req.user as any).userId);
  }

  @Get('weapon-proficiency')
  @UseGuards(AuthGuard('jwt'))
  async getWeaponProficiency(@Request() req: ExpressRequest) {
    return this.characterService.getWeaponProficiencyByUserId((req.user as any).userId);
  }

  @Post('auto-feed')
  @UseGuards(AuthGuard('jwt'))
  async setAutoFeed(@Request() req: ExpressRequest, @Body() dto: SetAutoFeedDto): Promise<CharacterDto> {
    const character = await this.characterService.getCharacterByUserId((req.user as any).userId);
    if (!character) throw new Error('Character not found');
    return this.characterService.setAutoFeed(character.id, dto.enabled === true);
  }

  @Post('attributes/spend')
  @UseGuards(AuthGuard('jwt'))
  async spendAttributes(@Request() req: ExpressRequest, @Body() dto: SpendAttributePointsDto): Promise<CharacterDto> {
    const character = await this.characterService.getCharacterByUserId((req.user as any).userId);
    if (!character) throw new Error('Character not found');
    return this.characterService.spendAttributePoints(character.id, dto.attributes);
  }
}
