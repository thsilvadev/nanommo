import { Controller, Get, Post, UseGuards, Request, Body, Param } from '@nestjs/common';
import { TownService } from './town.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('town')
@UseGuards(JwtAuthGuard)
export class TownController {
  constructor(private readonly townService: TownService) {}

  @Get('vendor/catalog')
  getVendorCatalog() { return this.townService.getVendorCatalog(); }

  @Get('vendor/:vendorId/stock')
  getVendorStock(@Param('vendorId') vendorId: string) { return this.townService.getVendorStock(vendorId); }

  @Get('vendor/:vendorId/quote/:itemId')
  getVendorQuote(@Param('vendorId') vendorId: string, @Param('itemId') itemId: string) { return this.townService.getVendorQuote(vendorId, itemId); }

  @Post('vendor/:vendorId/buy')
  buyFromVendor(@Request() req: any, @Param('vendorId') vendorId: string, @Body() body: { itemId: string; quantity: number }) {
    return this.townService.buyFromVendor(req.user.characterId, vendorId, body.itemId, body.quantity);
  }

  @Post('vendor/:vendorId/sell')
  sellToVendor(@Request() req: any, @Param('vendorId') vendorId: string, @Body() body: { itemId: string; quantity: number }) {
    return this.townService.sellToVendor(req.user.characterId, vendorId, body.itemId, body.quantity);
  }

  @Get('warehouse/contents')
  getWarehouse(@Request() req: any) { return this.townService.getWarehouse(req.user.characterId); }
  @Get('warehouse/capacity')
  getWarehouseCapacity(@Request() req: any) { return this.townService.getWarehouseCapacity(req.user.characterId); }
  @Post('warehouse/deposit')
  depositToWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) { return this.townService.depositToWarehouse(req.user.characterId, body.itemId, body.quantity); }
  @Post('warehouse/withdraw')
  withdrawFromWarehouse(@Request() req: any, @Body() body: { itemId: string; quantity: number }) { return this.townService.withdrawFromWarehouse(req.user.characterId, body.itemId, body.quantity); }

  @Get('npcs')
  getTownNPCs() { return this.townService.getTownNPCs(); }
  @Post('npcs/:npcId/interact')
  interactWithNPC(@Param('npcId') npcId: string, @Body() body: { action: string }) { return this.townService.interactWithNPC(npcId, body.action); }
  @Get('news')
  getTownNews() { return this.townService.getTownNews(); }
}
