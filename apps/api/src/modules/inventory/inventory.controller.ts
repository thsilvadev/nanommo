import { Controller, Get, Post, Put, UseGuards, Request, Body, Param, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CharacterService } from '../character/character.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly characterService: CharacterService,
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
    return this.inventoryService.useConsumable(character.id, body.itemId);
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
