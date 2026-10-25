import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { MarketOrder } from '../../database/entities/market-order.entity';
import { MarketDeal } from '../../database/entities/market-deal.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
import { MAX_MARKET_ORDER_GOLD } from '@nanommo/shared';
import { marketGrossValue, marketListingFee } from './market-contract';
import { BattleService } from '../battle/battle.service';
import { MailService } from '../mail/mail.service';

const CHARACTER_GOLD_CAP = 1_000_000_000_000;

@Injectable()
export class MarketService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer: NodeJS.Timeout | null = null;
  private expiryInProgress = false;
  private readonly logger = new Logger('MarketService');
  private readonly ORDER_TTL_DAYS = 7;
  private readonly ACTIVE_ORDERS_LIMIT = 10;

  constructor(
    @InjectRepository(MarketOrder) private readonly marketOrderRepo: Repository<MarketOrder>,
    @InjectRepository(MarketDeal) private readonly marketDealRepo: Repository<MarketDeal>,
    @InjectRepository(InventoryItem) private readonly inventoryRepo: Repository<InventoryItem>,
    @InjectRepository(Character) private readonly characterRepo: Repository<Character>,
    private readonly dataService: DataService,
    private readonly battleService: BattleService,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // Startup recovery reconciles retired buy-order escrow and due sell-order expiries.
    const startupTimer = setTimeout(() => { void this.runExpirySafely(); }, 5000);
    (startupTimer as any).unref?.();
    this.expiryTimer = setInterval(() => { void this.runExpirySafely(); }, 60_000);
    (this.expiryTimer as any).unref?.();
  }
  onModuleDestroy(): void { if (this.expiryTimer) clearInterval(this.expiryTimer); this.expiryTimer = null; }
  private async runExpirySafely(): Promise<void> {
    if (this.expiryInProgress) return;
    this.expiryInProgress = true;
    try { await this.expireOrders(); }
    catch (error) { this.logger.error('Market expiry/legacy escrow reconciliation failed', error instanceof Error ? error.stack : String(error)); }
    finally { this.expiryInProgress = false; }
  }

  async getMarketOrders(itemId: string): Promise<MarketOrder[]> { return this.getSellOrders(itemId); }
  async getBuyOrders(_itemId: string): Promise<MarketOrder[]> { return []; }

  async searchListings(filters: { query?: string; type?: string; tier?: string; minPrice?: string; maxPrice?: string; sort?: string; page?: string; pageSize?: string }): Promise<any> {
    const query = String(filters.query ?? '').trim().toLocaleLowerCase();
    const type = String(filters.type ?? '').trim();
    const tier = filters.tier === undefined || filters.tier === '' ? null : Number(filters.tier);
    const minPrice = filters.minPrice === undefined || filters.minPrice === '' ? null : Number(filters.minPrice);
    const maxPrice = filters.maxPrice === undefined || filters.maxPrice === '' ? null : Number(filters.maxPrice);
    const page = Math.max(1, Math.trunc(Number(filters.page) || 1));
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(filters.pageSize) || 20)));
    const sort = filters.sort === 'highest' ? 'highest' : 'lowest';
    const orders = await this.marketOrderRepo.find({
      where: { type: 'sell', status: 'active' },
      order: sort === 'highest' ? { pricePerUnit: 'DESC', createdAt: 'ASC' } : { pricePerUnit: 'ASC', createdAt: 'ASC' },
      take: 5000,
    });
    const listings = orders.filter(order => {
      if (order.expiresAt.getTime() <= Date.now() || Number(order.escrowedItemQuantity ?? 0) <= 0) return false;
      const item = this.dataService.getItemById(order.itemId);
      if (!item) return false;
      if (query && !String(item.name ?? order.itemId).toLocaleLowerCase().includes(query)) return false;
      if (type && String(item.type ?? '') !== type) return false;
      if (tier !== null && Number(item.tier ?? 0) !== tier) return false;
      if (minPrice !== null && (!Number.isFinite(minPrice) || order.pricePerUnit < minPrice)) return false;
      if (maxPrice !== null && (!Number.isFinite(maxPrice) || order.pricePerUnit > maxPrice)) return false;
      return true;
    });
    const total = listings.length;
    return { items: listings.slice((page - 1) * pageSize, page * pageSize).map(order => {
      const item = this.dataService.getItemById(order.itemId);
      return { ...order, itemName: item?.name ?? order.itemId, itemType: item?.type ?? 'unknown', tier: Number(item?.tier ?? 0), remainingQuantity: Number(order.escrowedItemQuantity ?? 0) };
    }), total, page, pageSize, sort };
  }

  async getPriceSuggestion(characterId: string, itemId: string): Promise<any> {
    const item = this.dataService.getItemById(itemId);
    if (!item) throw new NotFoundException('Item definition not found');
    const offers = await this.marketOrderRepo.find({
      where: { itemId, type: 'sell', status: 'active' },
      order: { pricePerUnit: 'ASC', createdAt: 'ASC' },
      take: 50,
    });
    const activeOffers = offers.filter(order => order.expiresAt.getTime() > Date.now() && Number(order.escrowedItemQuantity ?? 0) > 0);
    const competing = activeOffers.find(order => order.characterId !== characterId);
    if (competing) return {
      suggestedUnitPrice: Number(competing.pricePerUnit) > 1 ? Number(competing.pricePerUnit) - 1 : null,
      reason: 'undercut_lowest_other_player_offer',
      offers: activeOffers.map(order => ({ orderId: order.id, characterId: order.characterId, pricePerUnit: Number(order.pricePerUnit), quantity: Number(order.escrowedItemQuantity ?? 0), itemInstanceData: order.itemInstanceData ?? null, isOwn: order.characterId === characterId })),
    };
    const latestDeal = await this.marketDealRepo.findOne({ where: { itemId }, order: { dealAt: 'DESC' } });
    const suggested = latestDeal ? Number(latestDeal.pricePerUnit) - 1 : null;
    return {
      suggestedUnitPrice: suggested !== null && suggested > 0 ? suggested : null,
      reason: latestDeal ? 'undercut_latest_deal' : 'no_price_history',
      offers: activeOffers.map(order => ({ orderId: order.id, characterId: order.characterId, pricePerUnit: Number(order.pricePerUnit), quantity: Number(order.escrowedItemQuantity ?? 0), itemInstanceData: order.itemInstanceData ?? null, isOwn: order.characterId === characterId })),
    };
  }

  async getSellOrders(itemId: string): Promise<MarketOrder[]> {
    return this.marketOrderRepo.find({ where: { itemId, type: 'sell', status: 'active' }, order: { pricePerUnit: 'ASC', createdAt: 'ASC' }, take: 50 });
  }

  async placeBuyOrder(): Promise<never> { throw new ForbiddenException('Buy orders are disabled; Market is sell-only'); }

  async placeSellOrder(characterId: string, itemId: string, quantity: number, pricePerUnit: number, _untrustedInstanceData?: any, inventoryItemId?: string): Promise<{ order: MarketOrder; matches: MarketDeal[] }> {
    if (!characterId) throw new NotFoundException('Character not found for authenticated account');
    return this.battleService.withCharacterQueueLock(characterId, () => this.dataSource.transaction(async manager => {
      const characters = manager.getRepository(Character);
      const inventory = manager.getRepository(InventoryItem);
      const orders = manager.getRepository(MarketOrder);
      const character = await characters.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      if (character.status === 'dead_pending_return') throw new BadRequestException('Cannot list items while dead');
      const itemDef = this.dataService.getItemById(itemId);
      if (!itemDef) throw new NotFoundException('Item definition not found');
      if (itemDef.questOnly === true) throw new BadRequestException('Quest-only items cannot be listed on the Market');
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(pricePerUnit) || pricePerUnit < 1) throw new BadRequestException('Quantity and unit price must be positive integers');
      const gross = marketGrossValue(quantity, pricePerUnit);
      const activeCount = await orders.count({ where: { characterId, type: 'sell', status: 'active' } });
      if (activeCount >= this.ACTIVE_ORDERS_LIMIT) throw new BadRequestException(`Cannot have more than ${this.ACTIVE_ORDERS_LIMIT} active sell listings`);
      const source = await inventory.findOne({
        where: inventoryItemId ? { id: inventoryItemId, characterId, itemId, location: 'inventory' } : { characterId, itemId, location: 'inventory' },
        order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' },
      } as any);
      if (!source) throw new NotFoundException('Selected inventory stack not found');
      if (source.quantity !== quantity) throw new BadRequestException('Market listing must use the full selected stack; split the stack in Inventory first');
      if (source.instanceData?.questReward?.marketTradable === false && typeof source.instanceData?.questReward?.questId === 'string') throw new BadRequestException('Quest-reward equipment cannot be listed on the Market');
      if ((!itemDef.stackable || Number(itemDef.maxStack ?? 1) <= 1) && quantity !== 1) throw new BadRequestException('Non-stackable items must be listed one at a time');
      if (character.cookingSession) {
        const reserved = (character.cookingSession.ingredients ?? []).filter((row: any) => row.itemId === itemId).reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
        const owned = await inventory.find({ where: { characterId, itemId, location: 'inventory' } });
        if (owned.reduce((sum, row) => sum + Number(row.quantity), 0) - source.quantity < reserved) throw new BadRequestException('Items are reserved for your active Cooking session');
      }
      const fee = marketListingFee(gross);
      if (Number(character.gold) < fee) throw new BadRequestException(`Insufficient gold for listing fee: need ${fee}`);
      character.gold = Number(character.gold) - fee;
      await characters.save(character);
      await inventory.remove(source);
      const order = orders.create({
        characterId, type: 'sell', itemId, itemInstanceData: source.instanceData ?? null,
        quantity, pricePerUnit, escrowedItemQuantity: quantity, escrowedGold: 0,
        listingFeeGold: fee, status: 'active', createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.ORDER_TTL_DAYS * 24 * 60 * 60 * 1000),
      });
      return { order: await orders.save(order), matches: [] };
    }));
  }

  async purchaseOrder(characterId: string, orderId: string, quantity: number): Promise<MarketDeal> {
    if (!characterId) throw new NotFoundException('Character not found for authenticated account');
    return this.battleService.withCharacterQueueLock(characterId, () => this.dataSource.transaction(async manager => {
      const orders = manager.getRepository(MarketOrder);
      const characters = manager.getRepository(Character);
      const deals = manager.getRepository(MarketDeal);
      const order = await orders.findOne({ where: { id: orderId, type: 'sell', status: 'active' }, lock: { mode: 'pessimistic_write' } });
      if (!order || order.expiresAt.getTime() <= Date.now()) throw new NotFoundException('Active sell listing not found');
      if (order.characterId === characterId) throw new BadRequestException('You cannot purchase your own listing');
      const remaining = Number(order.escrowedItemQuantity ?? 0);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > remaining) throw new BadRequestException('Purchase quantity exceeds the remaining listing quantity');
      const itemDef = this.dataService.getItemById(order.itemId);
      if (!itemDef) throw new BadRequestException('Listing references an unknown item');
      if (itemDef.questOnly === true || (order.itemInstanceData?.questReward?.marketTradable === false && typeof order.itemInstanceData?.questReward?.questId === 'string')) throw new BadRequestException('Quest-only items and quest-reward equipment cannot be purchased through the Market');
      if ((!itemDef.stackable || Number(itemDef.maxStack ?? 1) <= 1) && quantity !== 1) throw new BadRequestException('Equipment listings must be purchased as a whole instance');
      const gross = marketGrossValue(quantity, Number(order.pricePerUnit));
      const buyer = await characters.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!buyer) throw new NotFoundException('Buyer character not found');
      if (Number(buyer.gold) < gross) throw new BadRequestException(`Insufficient gold: need ${gross}, have ${Number(buyer.gold)}`);
      const seller = await characters.findOne({ where: { id: order.characterId } });
      if (!seller) throw new NotFoundException('Seller character not found');
      buyer.gold = Number(buyer.gold) - gross;
      await characters.save(buyer);
      const deal = await deals.save(deals.create({
        buyerCharacterId: buyer.id, sellerCharacterId: seller.id, itemId: order.itemId,
        itemInstanceData: order.itemInstanceData ?? null, quantity, pricePerUnit: order.pricePerUnit,
        feeCollected: 0, dealAt: new Date(),
      }));
      order.escrowedItemQuantity = remaining - quantity;
      if (Number(order.escrowedItemQuantity) === 0) order.status = 'fulfilled';
      await orders.save(order);
      await this.mailService.sendSystemMail(
        buyer.id, 'Market purchase delivery', 'Your purchased item is waiting for collection in Town.', undefined,
        { itemId: order.itemId, quantity, itemInstanceData: order.itemInstanceData ?? null },
        manager, `market-deal:${deal.id}:buyer-item`,
      );
      await this.mailService.sendSystemMail(
        seller.id, 'Market sale proceeds', 'Gold from your Market sale is waiting for collection in Town.', gross,
        undefined, manager, `market-deal:${deal.id}:seller-gold`,
      );
      return deal;
    }));
  }

  async cancelOrder(orderId: string, characterId: string): Promise<void> {
    await this.dataSource.transaction(async manager => {
      const order = await manager.getRepository(MarketOrder).findOne({ where: { id: orderId, characterId, status: 'active' }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('Order not found or already completed');
      await this.releaseOrderEscrow(order, 'Market listing cancelled', manager);
    });
  }

  private async releaseOrderEscrow(order: MarketOrder, reason: string, manager: any): Promise<void> {
    const orders = manager.getRepository(MarketOrder);
    const characters = manager.getRepository(Character);
    const character = await characters.findOne({ where: { id: order.characterId } });
    if (!character) throw new NotFoundException('Order owner character not found');
    if (order.type === 'sell') {
      const qty = Math.max(0, Number(order.escrowedItemQuantity ?? 0));
      if (qty > 0) {
        const key = `market-order-return:${order.id}`;
        await this.mailService.sendSystemMail(character.id, reason, 'Your remaining listing items are waiting for collection in Town.',
          undefined, { itemId: order.itemId, quantity: qty, itemInstanceData: order.itemInstanceData ?? null }, manager, key);
      }
      order.escrowedItemQuantity = 0;
    } else {
      const escrow = Math.max(0, Number(order.escrowedGold ?? 0));
      // Historical buy-order escrow is returned in bounded, independently idempotent mail attachments.
      let remaining = escrow; let part = 0;
      while (remaining > 0) {
        const amount = Math.min(remaining, MAX_MARKET_ORDER_GOLD);
        const key = `market-legacy-buy-refund:${order.id}:${part++}`;
        await this.mailService.sendSystemMail(character.id, 'Legacy Market escrow return',
          'Gold escrow from a retired buy order is waiting for collection in Town.', amount, undefined, manager, key);
        remaining -= amount;
      }
      order.escrowedGold = 0;
    }
    order.status = reason.includes('expired') ? 'expired' : 'cancelled';
    await orders.save(order);
    this.logger.debug(`Released escrow for order ${order.id}: ${reason}`);
  }

  async getCharacterOrders(characterId: string): Promise<MarketOrder[]> {
    return this.marketOrderRepo.find({ where: { characterId, type: 'sell', status: 'active' }, order: { createdAt: 'DESC' } });
  }

  async getCharacterDeals(characterId: string): Promise<MarketDeal[]> {
    return this.marketDealRepo.find({ where: [{ buyerCharacterId: characterId }, { sellerCharacterId: characterId }] as any, order: { dealAt: 'DESC' }, take: 15 });
  }

  async getPriceHistory(itemId: string, days = 7): Promise<any[]> {
    const since = new Date(Date.now() - Math.max(1, Math.min(365, Number(days) || 7)) * 24 * 60 * 60 * 1000);
    const deals = await this.marketDealRepo.find({ where: { itemId, dealAt: LessThan(new Date()) } as any, order: { dealAt: 'ASC' } });
    const byDay: Record<string, number[]> = {};
    for (const deal of deals.filter(d => d.dealAt >= since)) {
      const day = deal.dealAt.toISOString().slice(0, 10);
      (byDay[day] ??= []).push(Number(deal.pricePerUnit));
    }
    return Object.entries(byDay).map(([date, prices]) => ({ date, minPrice: Math.min(...prices), maxPrice: Math.max(...prices), avgPrice: Math.floor(prices.reduce((a, b) => a + b, 0) / prices.length), dealCount: prices.length }));
  }

  async expireOrders(): Promise<number> {
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(MarketOrder);
      const legacyBuys = await repo.find({ where: { type: 'buy', status: 'active' }, order: { createdAt: 'ASC' }, take: 200, lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' } as any });
      for (const order of legacyBuys) await this.releaseOrderEscrow(order, 'Legacy buy order escrow returned', manager);
      const due = await repo.find({ where: { type: 'sell', status: 'active', expiresAt: LessThan(new Date()) }, order: { expiresAt: 'ASC' }, take: 200, lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' } as any });
      for (const order of due) await this.releaseOrderEscrow(order, 'Market listing expired', manager);
      return legacyBuys.length + due.length;
    });
  }
}
