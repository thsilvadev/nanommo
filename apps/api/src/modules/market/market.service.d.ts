import { Repository, DataSource } from 'typeorm';
import { MarketOrder } from '../../database/entities/market-order.entity';
import { MarketDeal } from '../../database/entities/market-deal.entity';
import { MailMessage } from '../../database/entities/mail-message.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
import { GatewayService } from '../gateway/gateway.service';
import { Redis } from 'ioredis';
export declare class MarketService {
    private readonly marketOrderRepo;
    private readonly marketDealRepo;
    private readonly mailRepo;
    private readonly inventoryRepo;
    private readonly characterRepo;
    private readonly dataService;
    private readonly gatewayService;
    private readonly redis;
    private readonly dataSource;
    private readonly logger;
    private readonly LISTING_FEE;
    private readonly BUYER_FEE_PERCENT;
    private readonly ORDER_TTL_DAYS;
    private readonly ACTIVE_ORDERS_PER_SIDE_LIMIT;
    constructor(marketOrderRepo: Repository<MarketOrder>, marketDealRepo: Repository<MarketDeal>, mailRepo: Repository<MailMessage>, inventoryRepo: Repository<InventoryItem>, characterRepo: Repository<Character>, dataService: DataService, gatewayService: GatewayService, redis: Redis, dataSource: DataSource);
    /**
     * Get all active market orders for an item
     */
    getMarketOrders(itemId: string): Promise<MarketOrder[]>;
    /**
     * Get buy orders for an item (highest bids first)
     */
    getBuyOrders(itemId: string): Promise<MarketOrder[]>;
    /**
     * Get sell orders for an item (lowest asks first)
     */
    getSellOrders(itemId: string): Promise<MarketOrder[]>;
    /**
     * Place a buy order with automatic matching
     */
    placeBuyOrder(characterId: string, itemId: string, quantity: number, pricePerUnit: number): Promise<{
        order: MarketOrder;
        matches: MarketDeal[];
    }>;
    /**
     * Place a sell order with automatic matching
     */
    placeSellOrder(characterId: string, itemId: string, quantity: number, pricePerUnit: number, itemInstanceData?: any): Promise<{
        order: MarketOrder;
        matches: MarketDeal[];
    }>;
    /**
     * Cancel an active order
     */
    cancelOrder(orderId: string, characterId: string): Promise<void>;
    /**
     * Internal: Match a buy order against existing sell orders
     */
    private matchBuyOrder;
    /**
     * Internal: Match a sell order against existing buy orders
     */
    private matchSellOrder;
    /**
     * Internal: Release escrow (cancellation/expiry)
     */
    private releaseOrderEscrow;
    /**
     * Get character's active orders
     */
    getCharacterOrders(characterId: string): Promise<MarketOrder[]>;
    /**
     * Get character's deal history (last 15)
     */
    getCharacterDeals(characterId: string): Promise<MarketDeal[]>;
    /**
     * Get price history for an item
     */
    getPriceHistory(itemId: string, days?: number): Promise<any[]>;
    /**
     * Expire old orders (scheduled job)
     */
    expireOrders(): Promise<number>;
}
//# sourceMappingURL=market.service.d.ts.map