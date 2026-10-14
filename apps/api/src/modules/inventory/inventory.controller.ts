import { Controller, Get, Post, Put, UseGuards, Request, Body, Param, Query, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CharacterService } from '../character/character.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BattleService } from '../battle/battle.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly characterService: CharacterService,
    @Inject(forwardRef(() => BattleService)) private readonly battleService: BattleService,
  ) {}

  /**
   * Get full inventory for character
   */
  @Get()
  async getInventory(@Request() req: any) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    return {
      items: await this.inventoryService.getInventory(character.id),
      stateVersion: character.stateVersion,
    };
  }

  private async getConsistentInventorySnapshot(characterId: string) {
    // Inventory and Character are changed together. Re-read until the revision is
    // stable around the inventory query so a concurrent battle/mutation cannot
    // pair new Character state with an older set of item slots.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const character = await this.characterService.getCharacterDtoById(characterId);
      if (!character) throw new BadRequestException('Character not found');
      const items = await this.inventoryService.getInventory(characterId);
      const persistedCharacter = await this.characterService.getCharacterById(characterId);
      if (persistedCharacter?.stateVersion === character.stateVersion) {
        return { items, character, stateVersion: character.stateVersion };
      }
    }
    throw new BadRequestException('Inventory changed; reload and retry');
  }

  /** Move an existing inventory item to a visual slot, swapping when occupied. */
  @Put('slot')
  async moveItemToSlot(
    @Request() req: any,
    @Body() body: { itemId: string; targetSlotIndex: number },
  ) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    await this.inventoryService.moveItemToSlot(
      character.id,
      body.itemId,
      Number(body.targetSlotIndex),
    );
    return this.getConsistentInventorySnapshot(character.id);
  }

  /** Sort by item type/name and compact all items into consecutive slots. */
  @Put('sort')
  async sortInventory(
    @Request() req: any,
    @Body() body: { itemIds: string[] },
  ) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    await this.inventoryService.sortInventory(character.id, body.itemIds);
    return this.getConsistentInventorySnapshot(character.id);
  }

  /**
   * Get warehouse items for character
   */
  @Get('warehouse')
  async getWarehouse(@Request() req: any) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    return this.inventoryService.getWarehouse(character.id);
  }

  /**
   * Get count of a specific item
   */
  @Get('item/:itemId/count')
  async getItemCount(@Request() req: any, @Param('itemId') itemId: string) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    return { count: await this.inventoryService.getItemCount(character.id, itemId) };
  }

  /**
   * Add item to inventory
   */
  @Post('add')
  async addItem(@Request() req: any, @Body() body: { itemId: string; quantity?: number }) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    const quantity = body.quantity || 1;
    return this.inventoryService.addItem(character.id, body.itemId, quantity);
  }

  /**
   * Remove item from inventory
   */
  @Post('remove')
  async removeItem(@Request() req: any, @Body() body: { itemId: string; quantity: number }) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    await this.inventoryService.removeItem(character.id, body.itemId, body.quantity);
    return { success: true };
  }

  @Post('use')
  async useConsumable(@Request() req: any, @Body() body: { itemId: string }) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    await this.battleService.runFutureCombatMutation(character.id, () =>
      this.inventoryService.useConsumable(character.id, body.itemId),
    );
    const characterAfter = await this.characterService.getCharacterDtoById(character.id);
    if (!characterAfter) throw new BadRequestException('Character not found');
    return {
      character: characterAfter,
      inventory: await this.inventoryService.getInventory(character.id),
      stateVersion: characterAfter.stateVersion,
    };
  }

  /**
   * Transfer item to warehouse
   */
  @Post('to-warehouse')
  async transferToWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    await this.inventoryService.transferToWarehouse(character.id, body.itemId, body.quantity);
    return { success: true };
  }

  /**
   * Transfer item from warehouse
   */
  @Post('from-warehouse')
  async transferFromWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) {
    const userId = req.user.userId;
    const character = await this.characterService.getCharacterByUserId(userId);
    await this.inventoryService.transferFromWarehouse(character.id, body.itemId, body.quantity);
    return { success: true };
  }


}
