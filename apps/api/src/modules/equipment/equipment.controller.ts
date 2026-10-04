import { Controller, Get, Post, Put, Delete, UseGuards, Request, Body, Param, BadRequestException } from '@nestjs/common';
import { EquipmentService } from './equipment.service';
import { CharacterService } from '../character/character.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryService } from '../inventory/inventory.service';

@Controller('equipment')
@UseGuards(JwtAuthGuard)
export class EquipmentController {
  constructor(
    private readonly equipmentService: EquipmentService,
    private readonly characterService: CharacterService,
    private readonly inventoryService: InventoryService,
  ) {}

  private async getCharacterId(userId: string): Promise<string> {
    const character = await this.characterService.getCharacterByUserId(userId);
    if (!character) throw new BadRequestException('Character not found');
    return character.id;
  }

  /**
   * Get all equipped items for character
   */
  @Get()
  async getEquipment(@Request() req: any) {
    const characterId = await this.getCharacterId(req.user.userId);
    return this.equipmentService.getEquipment(characterId);
  }

  /**
   * Get equipment loadout summary
   */
  @Get('summary')
  async getLoadoutSummary(@Request() req: any) {
    const characterId = await this.getCharacterId(req.user.userId);
    return this.equipmentService.getLoadoutSummary(characterId);
  }

  /**
   * Get item in specific slot
   */
  @Get('slot/:slot')
  async getEquippedInSlot(@Request() req: any, @Param('slot') slot: string) {
    const characterId = await this.getCharacterId(req.user.userId);
    return this.equipmentService.getEquippedInSlot(characterId, slot);
  }

  /**
   * Get total stat bonuses from equipment
   */
  @Get('stats/total')
  async getEquipmentStats(@Request() req: any) {
    const characterId = await this.getCharacterId(req.user.userId);
    return this.equipmentService.calculateEquipmentStats(characterId);
  }

  /**
   * Equip an item
   */
  @Put('equip')
  async equipItem(@Request() req: any, @Body() body: { slot: string; itemId: string }) {
    const characterId = await this.getCharacterId(req.user.userId);
    await this.equipmentService.equipItem(characterId, body.slot, body.itemId);
    return this.getMutationSnapshot(characterId);
  }

  /**
   * Unequip an item
   */
  @Delete('slot/:slot')
  async unequipItem(@Request() req: any, @Param('slot') slot: string) {
    const characterId = await this.getCharacterId(req.user.userId);
    await this.equipmentService.unequipItem(characterId, slot);
    return this.getMutationSnapshot(characterId);
  }

  private async getMutationSnapshot(characterId: string) {
    const character = await this.characterService.getCharacterDtoById(characterId);
    if (!character) throw new BadRequestException('Character not found');
    return {
      character,
      equipment: await this.equipmentService.getEquipment(characterId),
      inventory: await this.inventoryService.getInventory(characterId),
      stateVersion: character.stateVersion,
    };
  }

  /**
   * Validate weapon combination
   */
  @Post('validate-weapons')
  async validateWeaponCombination(
    @Request() req: any,
    @Body() body: { mainWeapon: string; offHandWeapon?: string },
  ) {
    const characterId = await this.getCharacterId(req.user.userId);
    return this.equipmentService.validateWeaponCombination(
      characterId,
      body.mainWeapon,
      body.offHandWeapon,
    );
  }
}
