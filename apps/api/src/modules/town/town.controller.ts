import { Controller, Get, Post, UseGuards, Request, Body, Param, NotFoundException, BadRequestException } from '@nestjs/common';
import { TownService } from './town.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CharacterService } from '../character/character.service';

@Controller('town')
@UseGuards(JwtAuthGuard)
export class TownController {
  constructor(
    private readonly townService: TownService,
    private readonly characterService: CharacterService,
  ) {}

  private async characterId(req: any): Promise<string> {
    const character = await this.characterService.getCharacterByUserId(req.user.userId);
    if (!character) throw new NotFoundException('Character not found');
    return character.id;
  }

  @Get('vendor/catalog')
  async getVendorCatalog(@Request() req: any) { return this.townService.getVendorCatalog(await this.characterId(req)); }

  @Get('vendor/:vendorId/stock')
  async getVendorStock(@Request() req: any, @Param('vendorId') vendorId: string) { return this.townService.getVendorStock(await this.characterId(req), vendorId); }

  @Get('vendor/:vendorId/quote/:itemId')
  async getVendorQuote(@Request() req: any, @Param('vendorId') vendorId: string, @Param('itemId') itemId: string) { return this.townService.getVendorQuote(await this.characterId(req), vendorId, itemId); }

  @Post('vendor/:vendorId/buy')
  async buyFromVendor(@Request() req: any, @Param('vendorId') vendorId: string, @Body() body: { itemId: string; quantity: number }) {
    return this.townService.buyFromVendor(await this.characterId(req), vendorId, body.itemId, body.quantity);
  }

  @Post('vendor/:vendorId/sell')
  async sellToVendor(@Request() req: any, @Param('vendorId') vendorId: string, @Body() body: { itemId: string; quantity: number; sourceInventoryItemId?: string }) {
    return this.townService.sellToVendor(await this.characterId(req), vendorId, body.itemId, body.quantity, body.sourceInventoryItemId);
  }

  @Get('warehouse/contents')
  async getWarehouse(@Request() req: any) { return this.townService.getWarehouse(await this.characterId(req)); }
  @Get('warehouse/capacity')
  async getWarehouseCapacity(@Request() req: any) { return this.townService.getWarehouseCapacity(await this.characterId(req)); }
  @Post('warehouse/deposit')
  async depositToWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) { return this.townService.depositToWarehouse(await this.characterId(req), body.itemId, body.quantity); }
  @Post('warehouse/withdraw')
  async withdrawFromWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) { return this.townService.withdrawFromWarehouse(await this.characterId(req), body.itemId, body.quantity); }
  @Post('warehouse/transfer')
  async transferWarehouseRow(@Request() req: any, @Body() body: { rowId: string; direction: 'deposit' | 'withdraw' }) {
    if (!body?.rowId || !['deposit', 'withdraw'].includes(body.direction)) throw new BadRequestException('A source row and valid transfer direction are required');
    return this.townService.transferWarehouseRow(await this.characterId(req), body.rowId, body.direction);
  }

  @Get('npcs')
  async getTownNPCs(@Request() req: any) { return this.townService.getTownNPCs(await this.characterId(req)); }
  @Get('npcs/:npcId/dialogue')
  async getNpcDialogue(@Request() req: any, @Param('npcId') npcId: string) {
    return this.townService.getNpcDialogue(await this.characterId(req), npcId);
  }
  @Post('npcs/:npcId/dialogue')
  async chooseNpcDialogue(@Request() req: any, @Param('npcId') npcId: string, @Body() body: { choiceId: string; nodeId?: string }) {
    return this.townService.chooseNpcDialogue(await this.characterId(req), npcId, body.choiceId, body.nodeId);
  }
  @Post('npcs/:npcId/interact')
  async interactWithNPC(@Request() req: any, @Param('npcId') npcId: string, @Body() body: { action: string }) {
    return this.townService.interactWithNPC(await this.characterId(req), npcId, body.action);
  }
  @Get('npcs/uncle_phillip/cooking')
  async getCookingState(@Request() req: any) { return this.townService.getCookingState(await this.characterId(req)); }
  @Post('npcs/uncle_phillip/cooking/start')
  async startCooking(@Request() req: any, @Body() body: { recipeId: string }) {
    if (!body || typeof body.recipeId !== 'string' || !body.recipeId) throw new BadRequestException('recipeId is required');
    return this.townService.startCooking(await this.characterId(req), body.recipeId);
  }
  @Post('npcs/uncle_phillip/cooking/cancel')
  async cancelCooking(@Request() req: any, @Body() body: { sessionId?: string }) { return this.townService.cancelCooking(await this.characterId(req), body?.sessionId); }

  @Get('news')
  getTownNews() { return this.townService.getTownNews(); }
}
