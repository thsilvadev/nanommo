import { Controller, Get, Post, Delete, UseGuards, Request, Body, Param, Query } from '@nestjs/common';
import { MarketService } from './market.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('market')
@UseGuards(JwtAuthGuard)
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  /**
   * Get all active orders for an item
   */
  @Get('orders/:itemId')
  async getMarketOrders(@Param('itemId') itemId: string) {
    return this.marketService.getMarketOrders(itemId);
  }

  /**
   * Get buy orders (highest bids) for an item
   */
  @Get('orders/:itemId/buy')
  async getBuyOrders(@Param('itemId') itemId: string) {
    return this.marketService.getBuyOrders(itemId);
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
   * Place a buy order
   */
  @Post('orders/buy')
  async placeBuyOrder(
    @Request() req: any,
    @Body() body: { itemId: string; quantity: number; pricePerUnit: number },
  ) {
    const characterId = req.user.characterId;
    return this.marketService.placeBuyOrder(
      characterId,
      body.itemId,
      body.quantity,
      body.pricePerUnit,
    );
  }

  /**
   * Place a sell order
   */
  @Post('orders/sell')
  async placeSellOrder(
    @Request() req: any,
    @Body() body: { itemId: string; quantity: number; pricePerUnit: number; itemInstanceData?: any },
  ) {
    const characterId = req.user.characterId;
    return this.marketService.placeSellOrder(
      characterId,
      body.itemId,
      body.quantity,
      body.pricePerUnit,
      body.itemInstanceData,
    );
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
