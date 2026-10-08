import { Controller, Get, Post, UseGuards, Request, Body, Param, NotFoundException } from '@nestjs/common';
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
  async sellToVendor(@Request() req: any, @Param('vendorId') vendorId: string, @Body() body: { itemId: string; quantity: number }) {
    return this.townService.sellToVendor(await this.characterId(req), vendorId, body.itemId, body.quantity);
  }

  @Get('warehouse/contents')
  async getWarehouse(@Request() req: any) { return this.townService.getWarehouse(await this.characterId(req)); }
  @Get('warehouse/capacity')
  async getWarehouseCapacity(@Request() req: any) { return this.townService.getWarehouseCapacity(await this.characterId(req)); }
  @Post('warehouse/deposit')
  async depositToWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) { return this.townService.depositToWarehouse(await this.characterId(req), body.itemId, body.quantity); }
  @Post('warehouse/withdraw')
  async withdrawFromWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) { return this.townService.withdrawFromWarehouse(await this.characterId(req), body.itemId, body.quantity); }

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
  @Get('news')
  getTownNews() { return this.townService.getTownNews(); }
}
