import { MarketService } from './market.service';
export declare class MarketController {
    private readonly marketService;
    constructor(marketService: MarketService);
    /**
     * Get all active orders for an item
     */
    getMarketOrders(itemId: string): Promise<import("../../database/entities").MarketOrder[]>;
    /**
     * Get buy orders (highest bids) for an item
     */
    getBuyOrders(itemId: string): Promise<import("../../database/entities").MarketOrder[]>;
    /**
     * Get sell orders (lowest asks) for an item
     */
    getSellOrders(itemId: string): Promise<import("../../database/entities").MarketOrder[]>;
    /**
     * Get price history for an item
     */
    getPriceHistory(itemId: string, days?: number): Promise<any[]>;
    /**
     * Get character's active orders
     */
    getCharacterOrders(req: any): Promise<import("../../database/entities").MarketOrder[]>;
    /**
     * Get character's completed deals
     */
    getCharacterDeals(req: any): Promise<import("../../database/entities").MarketDeal[]>;
    /**
     * Place a buy order
     */
    placeBuyOrder(req: any, body: {
        itemId: string;
        quantity: number;
        pricePerUnit: number;
    }): Promise<{
        order: import("../../database/entities").MarketOrder;
        matches: import("../../database/entities").MarketDeal[];
    }>;
    /**
     * Place a sell order
     */
    placeSellOrder(req: any, body: {
        itemId: string;
        quantity: number;
        pricePerUnit: number;
        itemInstanceData?: any;
    }): Promise<{
        order: import("../../database/entities").MarketOrder;
        matches: import("../../database/entities").MarketDeal[];
    }>;
    /**
     * Cancel an order
     */
    cancelOrder(req: any, orderId: string): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=market.controller.d.ts.map