import { Controller, Get, Post, Delete, UseGuards, Request, Body, Param, Query } from '@nestjs/common';
import { MarketService } from './market.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('market')
@UseGuards(JwtAuthGuard)
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get('listings')
  async searchListings(@Query() query: { query?: string; type?: string; tier?: string; minPrice?: string; maxPrice?: string; sort?: string; page?: string; pageSize?: string }) {
    return this.marketService.searchListings(query);
  }

  @Get('suggestion/:itemId')
  async getPriceSuggestion(@Request() req: any, @Param('itemId') itemId: string) {
    return this.marketService.getPriceSuggestion(req.user.characterId, itemId);
  }

  /**
   * Get all active orders for an item
   */
  @Get('orders/:itemId')
  async getMarketOrders(@Param('itemId') itemId: string) {
    return this.marketService.getMarketOrders(itemId);
  }

  /**
   * Get sell orders (lowest asks) for an item
   */
  @Get('orders/:itemId/sell')
  async getSellOrders(@Param('itemId') itemId: string) {
    return this.marketService.getSellOrders(itemId);
  }

  /**
   * Get price history for an item
   */
  @Get('history/:itemId')
  async getPriceHistory(@Param('itemId') itemId: string, @Query('days') days: number = 7) {
    return this.marketService.getPriceHistory(itemId, days);
  }

  /**
   * Get character's active orders
   */
  @Get('my-orders')
  async getCharacterOrders(@Request() req: any) {
    const characterId = req.user.characterId;
    return this.marketService.getCharacterOrders(characterId);
  }

  /**
   * Get character's completed deals
   */
  @Get('my-deals')
  async getCharacterDeals(@Request() req: any) {
    const characterId = req.user.characterId;
    return this.marketService.getCharacterDeals(characterId);
  }

  /**
   * Place a sell order
   */
  @Post('orders/sell')
  async placeSellOrder(
    @Request() req: any,
    @Body() body: { itemId: string; quantity: number; pricePerUnit: number; inventoryItemId?: string; itemInstanceData?: any },
  ) {
    const characterId = req.user.characterId;
    return this.marketService.placeSellOrder(
      characterId,
      body.itemId,
      body.quantity,
      body.pricePerUnit,
      body.itemInstanceData,
      body.inventoryItemId,
    );
  }


  /** Purchase part or all of an active sell listing. */
  @Post('orders/:orderId/purchase')
  async purchaseOrder(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() body: { quantity: number },
  ) {
    return this.marketService.purchaseOrder(req.user.characterId, orderId, body.quantity);
  }

  /**
   * Cancel an order
   */
  @Delete('orders/:orderId')
  async cancelOrder(@Request() req: any, @Param('orderId') orderId: string) {
    const characterId = req.user.characterId;
    await this.marketService.cancelOrder(orderId, characterId);
    return { success: true };
  }
}
