import { Injectable, Logger, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { MarketOrder } from '../../database/entities/market-order.entity';
import { MarketDeal } from '../../database/entities/market-deal.entity';
import { MailMessage } from '../../database/entities/mail-message.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
// import { GatewayService } from '../gateway/gateway.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

interface OrderMatch {
  buyOrder: MarketOrder;
  sellOrder: MarketOrder;
  matchQty: number;
  dealPrice: number;
}

@Injectable()
export class MarketService {
  private readonly logger = new Logger('MarketService');
  private readonly LISTING_FEE = 100; // Gold
  private readonly BUYER_FEE_PERCENT = 5; // 5% buyer fee
  private readonly ORDER_TTL_DAYS = 7;
  private readonly ACTIVE_ORDERS_PER_SIDE_LIMIT = 10;

  constructor(
    @InjectRepository(MarketOrder)
    private readonly marketOrderRepo: Repository<MarketOrder>,
    @InjectRepository(MarketDeal)
    private readonly marketDealRepo: Repository<MarketDeal>,
    @InjectRepository(MailMessage)
    private readonly mailRepo: Repository<MailMessage>,
    @InjectRepository(InventoryItem)
    private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    private readonly dataService: DataService,
    // private readonly gatewayService: GatewayService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get all active market orders for an item
   */
  async getMarketOrders(itemId: string): Promise<MarketOrder[]> {
    return this.marketOrderRepo.find({
      where: { itemId, status: 'active' },
      order: { createdAt: 'ASC' },
      take: 50,
    });
  }

  /**
   * Get buy orders for an item (highest bids first)
   */
  async getBuyOrders(itemId: string): Promise<MarketOrder[]> {
    return this.marketOrderRepo.find({
      where: { itemId, type: 'buy', status: 'active' },
      order: { pricePerUnit: 'DESC', createdAt: 'ASC' },
      take: 10,
    });
  }

  /**
   * Get sell orders for an item (lowest asks first)
   */
  async getSellOrders(itemId: string): Promise<MarketOrder[]> {
    return this.marketOrderRepo.find({
      where: { itemId, type: 'sell', status: 'active' },
      order: { pricePerUnit: 'ASC', createdAt: 'ASC' },
      take: 10,
    });
  }

  /**
   * Place a buy order with automatic matching
   */
  async placeBuyOrder(
    characterId: string,
    itemId: string,
    quantity: number,
    pricePerUnit: number,
  ): Promise<{ order: MarketOrder; matches: MarketDeal[] }> {
    return this.dataSource.transaction(async (txManager) => {
      const character = await txManager.findOne(Character, {
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!character) throw new NotFoundException('Character not found');

      const itemDef = this.dataService.getItemById(itemId);
      if (!itemDef) throw new BadRequestException('Item not found');

      const existingBuyOrders = await txManager.countBy(MarketOrder, {
        characterId,
        type: 'buy',
        status: 'active',
      } as any);

      if (existingBuyOrders >= this.ACTIVE_ORDERS_PER_SIDE_LIMIT) {
        throw new BadRequestException(
          `Cannot place more than ${this.ACTIVE_ORDERS_PER_SIDE_LIMIT} active buy orders`,
        );
      }

      const escrowedGold = Math.floor(quantity * pricePerUnit * (1 + this.BUYER_FEE_PERCENT / 100));
      const totalCost = this.LISTING_FEE + escrowedGold;

      const charGold = Number(character.gold);
      if (charGold < totalCost) {
        throw new BadRequestException(
          `Insufficient gold: need ${totalCost}, have ${charGold}`,
        );
      }

      character.gold = (charGold - totalCost) as any;
      await txManager.save(Character, character);

      const order = this.marketOrderRepo.create({
        characterId,
        type: 'buy',
        itemId,
        quantity,
        pricePerUnit,
        escrowedGold: escrowedGold as any,
        status: 'active',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.ORDER_TTL_DAYS * 24 * 60 * 60 * 1000),
      });

      const savedOrder = await txManager.save(MarketOrder, order);
      const matches = await this.matchBuyOrder(savedOrder, txManager);

      // await this.gatewayService.publishMarketOrderFilled(characterId, {
      //   orderId: (savedOrder as any).id,
      //   type: 'buy',
      //   itemId,
      //   quantity: savedOrder.quantity,
      //   pricePerUnit,
      //   matchCount: matches.length,
      // });

      return { order: savedOrder, matches };
    });
  }

  /**
   * Place a sell order with automatic matching
   */
  async placeSellOrder(
    characterId: string,
    itemId: string,
    quantity: number,
    pricePerUnit: number,
    itemInstanceData?: any,
  ): Promise<{ order: MarketOrder; matches: MarketDeal[] }> {
    return this.dataSource.transaction(async (txManager) => {
      const character = await txManager.findOne(Character, {
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!character) throw new NotFoundException('Character not found');

      const itemDef = this.dataService.getItemById(itemId);
      if (!itemDef) throw new BadRequestException('Item not found');

      const existingSellOrders = await txManager.countBy(MarketOrder, {
        characterId,
        type: 'sell',
        status: 'active',
      } as any);

      if (existingSellOrders >= this.ACTIVE_ORDERS_PER_SIDE_LIMIT) {
        throw new BadRequestException(
          `Cannot place more than ${this.ACTIVE_ORDERS_PER_SIDE_LIMIT} active sell orders`,
        );
      }

      const hasItems = await txManager.findOne(InventoryItem, {
        where: { characterId, itemId, location: 'inventory' } as any,
        lock: { mode: 'pessimistic_write' },
      });

      if (!hasItems || hasItems.quantity < quantity) {
        throw new BadRequestException(
          `Insufficient items: need ${quantity}, have ${hasItems?.quantity || 0}`,
        );
      }

      const charGold = Number(character.gold);
      if (charGold < this.LISTING_FEE) {
        throw new BadRequestException('Insufficient gold for listing fee');
      }

      character.gold = (charGold - this.LISTING_FEE) as any;
      await txManager.save(Character, character);

      hasItems.quantity -= quantity;
      if (hasItems.quantity === 0) {
        await txManager.delete(InventoryItem, hasItems.id);
      } else {
        await txManager.save(InventoryItem, hasItems);
      }

      const order = this.marketOrderRepo.create({
        characterId,
        type: 'sell',
        itemId,
        itemInstanceData,
        quantity,
        pricePerUnit,
        escrowedItemQuantity: quantity,
        status: 'active',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.ORDER_TTL_DAYS * 24 * 60 * 60 * 1000),
      });

      const savedOrder = await txManager.save(MarketOrder, order);
      const matches = await this.matchSellOrder(savedOrder, txManager);

      // await this.gatewayService.publishMarketOrderFilled(characterId, {
      //   orderId: (savedOrder as any).id,
      //   type: 'sell',
      //   itemId,
      //   quantity: savedOrder.quantity,
      //   pricePerUnit,
      //   matchCount: matches.length,
      // });

      return { order: savedOrder, matches };
    });
  }

  /**
   * Cancel an active order
   */
  async cancelOrder(orderId: string, characterId: string): Promise<void> {
    return this.dataSource.transaction(async (txManager) => {
      const order = await txManager.findOne(MarketOrder, {
        where: { id: orderId, characterId, status: 'active' },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) throw new NotFoundException('Order not found or already completed');

      await this.releaseOrderEscrow(order, 'Order cancelled by player', txManager);
    });
  }

  /**
   * Internal: Match a buy order against existing sell orders
   */
  private async matchBuyOrder(
    buyOrder: MarketOrder,
    txManager: any,
  ): Promise<MarketDeal[]> {
    const deals: MarketDeal[] = [];
    let remainingBuyQty = buyOrder.quantity;

    const sellOrders = await txManager.find(MarketOrder, {
      where: { itemId: buyOrder.itemId, type: 'sell', status: 'active' } as any,
      order: { pricePerUnit: 'ASC', createdAt: 'ASC' },
    });

    for (const sellOrder of sellOrders) {
      if (remainingBuyQty === 0) break;
      if (buyOrder.pricePerUnit < sellOrder.pricePerUnit) break;

      const escrowedQty = (sellOrder.escrowedItemQuantity || 0) as number;
      if (escrowedQty === 0) continue;

      const matchQty = Math.min(remainingBuyQty, escrowedQty);
      const dealPrice = sellOrder.pricePerUnit;
      const dealGold = matchQty * dealPrice;
      const feeGold = Math.floor(dealGold * (this.BUYER_FEE_PERCENT / 100));

      const deal = this.marketDealRepo.create({
        buyerCharacterId: buyOrder.characterId,
        sellerCharacterId: sellOrder.characterId,
        itemId: buyOrder.itemId,
        itemInstanceData: sellOrder.itemInstanceData,
        quantity: matchQty,
        pricePerUnit: dealPrice,
        feeCollected: feeGold,
        dealAt: new Date(),
      });

      await txManager.save(MarketDeal, deal);
      deals.push(deal);

      // Give gold to seller
      const seller = await txManager.findOne(Character, {
        where: { id: sellOrder.characterId },
        lock: { mode: 'pessimistic_write' },
      });

      if (seller) {
        seller.gold = (Number(seller.gold) + dealGold) as any;
        await txManager.save(Character, seller);
      }

      // Deliver item to buyer via mail
      const mail = this.mailRepo.create({
        recipientCharacterId: buyOrder.characterId,
        itemId: buyOrder.itemId,
        itemInstanceData: sellOrder.itemInstanceData,
        quantity: matchQty,
        subject: 'Market sale delivery',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        collected: false,
      });

      await txManager.save(MailMessage, mail);

      // await this.gatewayService.publishMailNewItem(buyOrder.characterId, {
      //   mailId: (mail as any).id,
      //   itemId: buyOrder.itemId,
      //   quantity: matchQty,
      //   subject: mail.subject,
      // });

      // Update quantities
      remainingBuyQty -= matchQty;
      sellOrder.escrowedItemQuantity = (sellOrder.escrowedItemQuantity || 0) - matchQty;

      if ((sellOrder.escrowedItemQuantity as number) === 0) {
        sellOrder.status = 'fulfilled';
      }

      await txManager.save(MarketOrder, sellOrder);
    }

    // Update buy order
    buyOrder.quantity = remainingBuyQty;
    if (remainingBuyQty === 0) {
      buyOrder.status = 'fulfilled';
    } else {
      // Refund unused escrow
      const buyer = await txManager.findOne(Character, {
        where: { id: buyOrder.characterId },
        lock: { mode: 'pessimistic_write' },
      });

      if (buyer) {
        const usedGold = deals.reduce((sum, deal) => sum + deal.quantity * deal.pricePerUnit, 0);
        const refundGold = Number(buyOrder.escrowedGold || 0) - Math.ceil(usedGold * (1 + this.BUYER_FEE_PERCENT / 100));

        if (refundGold > 0) {
          buyer.gold = (Number(buyer.gold) + refundGold) as any;
          await txManager.save(Character, buyer);
        }
      }
    }

    await txManager.save(MarketOrder, buyOrder);
    return deals;
  }

  /**
   * Internal: Match a sell order against existing buy orders
   */
  private async matchSellOrder(
    sellOrder: MarketOrder,
    txManager: any,
  ): Promise<MarketDeal[]> {
    const deals: MarketDeal[] = [];
    let remainingSellQty = (sellOrder.escrowedItemQuantity || 0) as number;

    const buyOrders = await txManager.find(MarketOrder, {
      where: { itemId: sellOrder.itemId, type: 'buy', status: 'active' } as any,
      order: { pricePerUnit: 'DESC', createdAt: 'ASC' },
    });

    for (const buyOrder of buyOrders) {
      if (remainingSellQty === 0) break;
      if (buyOrder.pricePerUnit < sellOrder.pricePerUnit) break;

      const matchQty = Math.min(remainingSellQty, buyOrder.quantity);
      if (matchQty === 0) continue;

      const dealPrice = sellOrder.pricePerUnit;
      const dealGold = matchQty * dealPrice;
      const feeGold = Math.floor(dealGold * (this.BUYER_FEE_PERCENT / 100));

      const deal = this.marketDealRepo.create({
        buyerCharacterId: buyOrder.characterId,
        sellerCharacterId: sellOrder.characterId,
        itemId: sellOrder.itemId,
        itemInstanceData: sellOrder.itemInstanceData,
        quantity: matchQty,
        pricePerUnit: dealPrice,
        feeCollected: feeGold,
        dealAt: new Date(),
      });

      await txManager.save(MarketDeal, deal);
      deals.push(deal);

      // Give gold to seller
      const seller = await txManager.findOne(Character, {
        where: { id: sellOrder.characterId },
        lock: { mode: 'pessimistic_write' },
      });

      if (seller) {
        seller.gold = (Number(seller.gold) + dealGold) as any;
        await txManager.save(Character, seller);
      }

      // Deliver item to buyer via mail
      const mail = this.mailRepo.create({
        recipientCharacterId: buyOrder.characterId,
        itemId: sellOrder.itemId,
        itemInstanceData: sellOrder.itemInstanceData,
        quantity: matchQty,
        subject: 'Market sale delivery',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        collected: false,
      });

      await txManager.save(MailMessage, mail);

      // await this.gatewayService.publishMailNewItem(buyOrder.characterId, {
      //   mailId: (mail as any).id,
      //   itemId: sellOrder.itemId,
      //   quantity: matchQty,
      //   subject: mail.subject,
      // });

      // Update quantities
      remainingSellQty -= matchQty;
      buyOrder.quantity -= matchQty;

      if (buyOrder.quantity === 0) {
        buyOrder.status = 'fulfilled';
      } else {
        // Refund unused escrow
        const buyer = await txManager.findOne(Character, {
          where: { id: buyOrder.characterId },
          lock: { mode: 'pessimistic_write' },
        });

        if (buyer) {
          const refundGold = buyOrder.quantity * sellOrder.pricePerUnit * (1 + this.BUYER_FEE_PERCENT / 100);
          buyer.gold = (Number(buyer.gold) + refundGold) as any;
          await txManager.save(Character, buyer);
        }
      }

      await txManager.save(MarketOrder, buyOrder);
    }

    // Update sell order
    sellOrder.escrowedItemQuantity = remainingSellQty;
    if (remainingSellQty === 0) {
      sellOrder.status = 'fulfilled';
    }

    await txManager.save(MarketOrder, sellOrder);
    return deals;
  }

  /**
   * Internal: Release escrow (cancellation/expiry)
   */
  private async releaseOrderEscrow(
    order: MarketOrder,
    reason: string,
    txManager: any,
  ): Promise<void> {
    order.status = order.status === 'expired' ? 'expired' : 'cancelled';
    await txManager.save(MarketOrder, order);

    if (order.type === 'sell') {
      // Return items to inventory
      if ((order.escrowedItemQuantity || 0) > 0) {
        let inventoryItem = await txManager.findOne(InventoryItem, {
          where: {
            characterId: order.characterId,
            itemId: order.itemId,
            location: 'inventory',
          } as any,
        });

        if (inventoryItem) {
          inventoryItem.quantity += (order.escrowedItemQuantity || 0);
        } else {
          inventoryItem = this.inventoryRepo.create({
            characterId: order.characterId,
            itemId: order.itemId,
            location: 'inventory',
            slotIndex: -1,
            quantity: (order.escrowedItemQuantity || 0),
            instanceData: order.itemInstanceData,
          } as any);
        }

        await txManager.save(InventoryItem, inventoryItem);
      }
    } else if (order.type === 'buy') {
      // Return gold
      const character = await txManager.findOne(Character, {
        where: { id: order.characterId },
        lock: { mode: 'pessimistic_write' },
      });

      if (character && order.escrowedGold) {
        character.gold = (Number(character.gold) + Number(order.escrowedGold)) as any;
        await txManager.save(Character, character);
      }
    }

    // Send notification mail
    const mail = this.mailRepo.create({
      recipientCharacterId: order.characterId,
      subject: reason,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      collected: true,
    });

    await txManager.save(MailMessage, mail);
    this.logger.debug(`Released escrow for order ${order.id}: ${reason}`);
  }

  /**
   * Get character's active orders
   */
  async getCharacterOrders(characterId: string): Promise<MarketOrder[]> {
    return this.marketOrderRepo.find({
      where: { characterId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get character's deal history (last 15)
   */
  async getCharacterDeals(characterId: string): Promise<MarketDeal[]> {
    return this.marketDealRepo.find({
      where: [
        { buyerCharacterId: characterId },
        { sellerCharacterId: characterId },
      ] as any,
      order: { dealAt: 'DESC' },
      take: 15,
    });
  }

  /**
   * Get price history for an item
   */
  async getPriceHistory(itemId: string, days: number = 7): Promise<any[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deals = await this.marketDealRepo.find({
      where: { itemId } as any,
      order: { dealAt: 'ASC' },
    });

    const filtered = deals.filter(d => d.dealAt >= since);
    const byDay: Record<string, number[]> = {};

    for (const deal of filtered) {
      const day = deal.dealAt.toISOString().split('T')[0];
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(deal.pricePerUnit);
    }

    return Object.entries(byDay).map(([date, prices]) => ({
      date,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: Math.floor(prices.reduce((a, b) => a + b, 0) / prices.length),
      dealCount: prices.length,
    }));
  }

  /**
   * Expire old orders (scheduled job)
   */
  async expireOrders(): Promise<number> {
    return this.dataSource.transaction(async (txManager) => {
      const cutoff = new Date(Date.now() - this.ORDER_TTL_DAYS * 24 * 60 * 60 * 1000);

      const expiredOrders = await this.marketOrderRepo.find({
        where: { status: 'active', createdAt: LessThan(cutoff) } as any,
      });

      for (const order of expiredOrders) {
        order.status = 'expired';
        await this.releaseOrderEscrow(order, 'Market order expired (7 days)', txManager);
      }

      return expiredOrders.length;
    });
  }
}
