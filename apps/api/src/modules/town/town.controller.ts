import { Controller, Get, Post, UseGuards, Request, Body, Param } from '@nestjs/common';
import { TownService } from './town.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('town')
@UseGuards(JwtAuthGuard)
export class TownController {
  constructor(private readonly townService: TownService) {}

  /**
   * Get vendor NPC catalog
   */
  @Get('vendor/catalog')
  async getVendorCatalog() {
    return this.townService.getVendorCatalog();
  }

  /**
   * Get stock for a specific vendor
   */
  @Get('vendor/:vendorId/stock')
  async getVendorStock(@Param('vendorId') vendorId: string) {
    return this.townService.getVendorStock(vendorId);
  }

  /**
   * Buy item from vendor
   */
  @Post('vendor/:vendorId/buy')
  async buyFromVendor(
    @Request() req: any,
    @Param('vendorId') vendorId: string,
    @Body() body: { itemId: string; quantity: number },
  ) {
    const characterId = req.user.characterId;
    await this.townService.buyFromVendor(characterId, vendorId, body.itemId, body.quantity);
    return { success: true };
  }

  /**
   * Get warehouse contents
   */
  @Get('warehouse/contents')
  async getWarehouse(@Request() req: any) {
    const characterId = req.user.characterId;
    return this.townService.getWarehouse(characterId);
  }

  /**
   * Get warehouse capacity info
   */
  @Get('warehouse/capacity')
  async getWarehouseCapacity(@Request() req: any) {
    const characterId = req.user.characterId;
    return this.townService.getWarehouseCapacity(characterId);
  }

  /**
   * Deposit item to warehouse
   */
  @Post('warehouse/deposit')
  async depositToWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) {
    const characterId = req.user.characterId;
    await this.townService.depositToWarehouse(characterId, body.itemId, body.quantity);
    return { success: true };
  }

  /**
   * Withdraw item from warehouse
   */
  @Post('warehouse/withdraw')
  async withdrawFromWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) {
    const characterId = req.user.characterId;
    await this.townService.withdrawFromWarehouse(characterId, body.itemId, body.quantity);
    return { success: true };
  }

  /**
   * Get list of town NPCs
   */
  @Get('npcs')
  async getTownNPCs() {
    return this.townService.getTownNPCs();
  }

  /**
   * Interact with NPC
   */
  @Post('npcs/:npcId/interact')
  async interactWithNPC(@Param('npcId') npcId: string, @Body() body: { action: string }) {
    return this.townService.interactWithNPC(npcId, body.action);
  }

  /**
   * Get town news/announcements
   */
  @Get('news')
  async getTownNews() {
    return this.townService.getTownNews();
  }
}
