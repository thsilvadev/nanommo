"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const market_order_entity_1 = require("../../database/entities/market-order.entity");
const market_deal_entity_1 = require("../../database/entities/market-deal.entity");
const mail_message_entity_1 = require("../../database/entities/mail-message.entity");
const inventory_item_entity_1 = require("../../database/entities/inventory-item.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const data_service_1 = require("../data/data.service");
const gateway_service_1 = require("../gateway/gateway.service");
const redis_provider_1 = require("../../config/redis.provider");
const ioredis_1 = require("ioredis");
let MarketService = class MarketService {
    marketOrderRepo;
    marketDealRepo;
    mailRepo;
    inventoryRepo;
    characterRepo;
    dataService;
    gatewayService;
    redis;
    dataSource;
    logger = new common_1.Logger('MarketService');
    LISTING_FEE = 100; // Gold
    BUYER_FEE_PERCENT = 5; // 5% buyer fee
    ORDER_TTL_DAYS = 7;
    ACTIVE_ORDERS_PER_SIDE_LIMIT = 10;
    constructor(marketOrderRepo, marketDealRepo, mailRepo, inventoryRepo, characterRepo, dataService, gatewayService, redis, dataSource) {
        this.marketOrderRepo = marketOrderRepo;
        this.marketDealRepo = marketDealRepo;
        this.mailRepo = mailRepo;
        this.inventoryRepo = inventoryRepo;
        this.characterRepo = characterRepo;
        this.dataService = dataService;
        this.gatewayService = gatewayService;
        this.redis = redis;
        this.dataSource = dataSource;
    }
    /**
     * Get all active market orders for an item
     */
    async getMarketOrders(itemId) {
        return this.marketOrderRepo.find({
            where: { itemId, status: 'active' },
            order: { createdAt: 'ASC' },
            take: 50,
        });
    }
    /**
     * Get buy orders for an item (highest bids first)
     */
    async getBuyOrders(itemId) {
        return this.marketOrderRepo.find({
            where: { itemId, type: 'buy', status: 'active' },
            order: { pricePerUnit: 'DESC', createdAt: 'ASC' },
            take: 10,
        });
    }
    /**
     * Get sell orders for an item (lowest asks first)
     */
    async getSellOrders(itemId) {
        return this.marketOrderRepo.find({
            where: { itemId, type: 'sell', status: 'active' },
            order: { pricePerUnit: 'ASC', createdAt: 'ASC' },
            take: 10,
        });
    }
    /**
     * Place a buy order with automatic matching
     */
    async placeBuyOrder(characterId, itemId, quantity, pricePerUnit) {
        return this.dataSource.transaction(async (txManager) => {
            const character = await txManager.findOne(character_entity_1.Character, {
                where: { id: characterId },
                lock: { mode: 'pessimistic_write' },
            });
            if (!character)
                throw new common_1.NotFoundException('Character not found');
            const itemDef = this.dataService.getItemById(itemId);
            if (!itemDef)
                throw new common_1.BadRequestException('Item not found');
            const existingBuyOrders = await txManager.countBy(market_order_entity_1.MarketOrder, {
                characterId,
                type: 'buy',
                status: 'active',
            });
            if (existingBuyOrders >= this.ACTIVE_ORDERS_PER_SIDE_LIMIT) {
                throw new common_1.BadRequestException(`Cannot place more than ${this.ACTIVE_ORDERS_PER_SIDE_LIMIT} active buy orders`);
            }
            const escrowedGold = Math.floor(quantity * pricePerUnit * (1 + this.BUYER_FEE_PERCENT / 100));
            const totalCost = this.LISTING_FEE + escrowedGold;
            const charGold = Number(character.gold);
            if (charGold < totalCost) {
                throw new common_1.BadRequestException(`Insufficient gold: need ${totalCost}, have ${charGold}`);
            }
            character.gold = (charGold - totalCost);
            await txManager.save(character_entity_1.Character, character);
            const order = this.marketOrderRepo.create({
                characterId,
                type: 'buy',
                itemId,
                quantity,
                pricePerUnit,
                escrowedGold: escrowedGold,
                status: 'active',
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + this.ORDER_TTL_DAYS * 24 * 60 * 60 * 1000),
            });
            const savedOrder = await txManager.save(market_order_entity_1.MarketOrder, order);
            const matches = await this.matchBuyOrder(savedOrder, txManager);
            await this.gatewayService.publishMarketOrderFilled(characterId, {
                orderId: savedOrder.id,
                type: 'buy',
                itemId,
                quantity: savedOrder.quantity,
                pricePerUnit,
                matchCount: matches.length,
            });
            return { order: savedOrder, matches };
        });
    }
    /**
     * Place a sell order with automatic matching
     */
    async placeSellOrder(characterId, itemId, quantity, pricePerUnit, itemInstanceData) {
        return this.dataSource.transaction(async (txManager) => {
            const character = await txManager.findOne(character_entity_1.Character, {
                where: { id: characterId },
                lock: { mode: 'pessimistic_write' },
            });
            if (!character)
                throw new common_1.NotFoundException('Character not found');
            const itemDef = this.dataService.getItemById(itemId);
            if (!itemDef)
                throw new common_1.BadRequestException('Item not found');
            const existingSellOrders = await txManager.countBy(market_order_entity_1.MarketOrder, {
                characterId,
                type: 'sell',
                status: 'active',
            });
            if (existingSellOrders >= this.ACTIVE_ORDERS_PER_SIDE_LIMIT) {
                throw new common_1.BadRequestException(`Cannot place more than ${this.ACTIVE_ORDERS_PER_SIDE_LIMIT} active sell orders`);
            }
            const hasItems = await txManager.findOne(inventory_item_entity_1.InventoryItem, {
                where: { characterId, itemId, location: 'inventory' },
                lock: { mode: 'pessimistic_write' },
            });
            if (!hasItems || hasItems.quantity < quantity) {
                throw new common_1.BadRequestException(`Insufficient items: need ${quantity}, have ${hasItems?.quantity || 0}`);
            }
            const charGold = Number(character.gold);
            if (charGold < this.LISTING_FEE) {
                throw new common_1.BadRequestException('Insufficient gold for listing fee');
            }
            character.gold = (charGold - this.LISTING_FEE);
            await txManager.save(character_entity_1.Character, character);
            hasItems.quantity -= quantity;
            if (hasItems.quantity === 0) {
                await txManager.delete(inventory_item_entity_1.InventoryItem, hasItems.id);
            }
            else {
                await txManager.save(inventory_item_entity_1.InventoryItem, hasItems);
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
            const savedOrder = await txManager.save(market_order_entity_1.MarketOrder, order);
            const matches = await this.matchSellOrder(savedOrder, txManager);
            await this.gatewayService.publishMarketOrderFilled(characterId, {
                orderId: savedOrder.id,
                type: 'sell',
                itemId,
                quantity: savedOrder.quantity,
                pricePerUnit,
                matchCount: matches.length,
            });
            return { order: savedOrder, matches };
        });
    }
    /**
     * Cancel an active order
     */
    async cancelOrder(orderId, characterId) {
        return this.dataSource.transaction(async (txManager) => {
            const order = await txManager.findOne(market_order_entity_1.MarketOrder, {
                where: { id: orderId, characterId, status: 'active' },
                lock: { mode: 'pessimistic_write' },
            });
            if (!order)
                throw new common_1.NotFoundException('Order not found or already completed');
            await this.releaseOrderEscrow(order, 'Order cancelled by player', txManager);
        });
    }
    /**
     * Internal: Match a buy order against existing sell orders
     */
    async matchBuyOrder(buyOrder, txManager) {
        const deals = [];
        let remainingBuyQty = buyOrder.quantity;
        const sellOrders = await txManager.find(market_order_entity_1.MarketOrder, {
            where: { itemId: buyOrder.itemId, type: 'sell', status: 'active' },
            order: { pricePerUnit: 'ASC', createdAt: 'ASC' },
        });
        for (const sellOrder of sellOrders) {
            if (remainingBuyQty === 0)
                break;
            if (buyOrder.pricePerUnit < sellOrder.pricePerUnit)
                break;
            const escrowedQty = (sellOrder.escrowedItemQuantity || 0);
            if (escrowedQty === 0)
                continue;
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
            await txManager.save(market_deal_entity_1.MarketDeal, deal);
            deals.push(deal);
            // Give gold to seller
            const seller = await txManager.findOne(character_entity_1.Character, {
                where: { id: sellOrder.characterId },
                lock: { mode: 'pessimistic_write' },
            });
            if (seller) {
                seller.gold = (Number(seller.gold) + dealGold);
                await txManager.save(character_entity_1.Character, seller);
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
            await txManager.save(mail_message_entity_1.MailMessage, mail);
            await this.gatewayService.publishMailNewItem(buyOrder.characterId, {
                mailId: mail.id,
                itemId: buyOrder.itemId,
                quantity: matchQty,
                subject: mail.subject,
            });
            // Update quantities
            remainingBuyQty -= matchQty;
            sellOrder.escrowedItemQuantity = (sellOrder.escrowedItemQuantity || 0) - matchQty;
            if (sellOrder.escrowedItemQuantity === 0) {
                sellOrder.status = 'fulfilled';
            }
            await txManager.save(market_order_entity_1.MarketOrder, sellOrder);
        }
        // Update buy order
        buyOrder.quantity = remainingBuyQty;
        if (remainingBuyQty === 0) {
            buyOrder.status = 'fulfilled';
        }
        else {
            // Refund unused escrow
            const buyer = await txManager.findOne(character_entity_1.Character, {
                where: { id: buyOrder.characterId },
                lock: { mode: 'pessimistic_write' },
            });
            if (buyer) {
                const usedGold = deals.reduce((sum, deal) => sum + deal.quantity * deal.pricePerUnit, 0);
                const refundGold = Number(buyOrder.escrowedGold || 0) - Math.ceil(usedGold * (1 + this.BUYER_FEE_PERCENT / 100));
                if (refundGold > 0) {
                    buyer.gold = (Number(buyer.gold) + refundGold);
                    await txManager.save(character_entity_1.Character, buyer);
                }
            }
        }
        await txManager.save(market_order_entity_1.MarketOrder, buyOrder);
        return deals;
    }
    /**
     * Internal: Match a sell order against existing buy orders
     */
    async matchSellOrder(sellOrder, txManager) {
        const deals = [];
        let remainingSellQty = (sellOrder.escrowedItemQuantity || 0);
        const buyOrders = await txManager.find(market_order_entity_1.MarketOrder, {
            where: { itemId: sellOrder.itemId, type: 'buy', status: 'active' },
            order: { pricePerUnit: 'DESC', createdAt: 'ASC' },
        });
        for (const buyOrder of buyOrders) {
            if (remainingSellQty === 0)
                break;
            if (buyOrder.pricePerUnit < sellOrder.pricePerUnit)
                break;
            const matchQty = Math.min(remainingSellQty, buyOrder.quantity);
            if (matchQty === 0)
                continue;
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
            await txManager.save(market_deal_entity_1.MarketDeal, deal);
            deals.push(deal);
            // Give gold to seller
            const seller = await txManager.findOne(character_entity_1.Character, {
                where: { id: sellOrder.characterId },
                lock: { mode: 'pessimistic_write' },
            });
            if (seller) {
                seller.gold = (Number(seller.gold) + dealGold);
                await txManager.save(character_entity_1.Character, seller);
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
            await txManager.save(mail_message_entity_1.MailMessage, mail);
            await this.gatewayService.publishMailNewItem(buyOrder.characterId, {
                mailId: mail.id,
                itemId: sellOrder.itemId,
                quantity: matchQty,
                subject: mail.subject,
            });
            // Update quantities
            remainingSellQty -= matchQty;
            buyOrder.quantity -= matchQty;
            if (buyOrder.quantity === 0) {
                buyOrder.status = 'fulfilled';
            }
            else {
                // Refund unused escrow
                const buyer = await txManager.findOne(character_entity_1.Character, {
                    where: { id: buyOrder.characterId },
                    lock: { mode: 'pessimistic_write' },
                });
                if (buyer) {
                    const refundGold = buyOrder.quantity * sellOrder.pricePerUnit * (1 + this.BUYER_FEE_PERCENT / 100);
                    buyer.gold = (Number(buyer.gold) + refundGold);
                    await txManager.save(character_entity_1.Character, buyer);
                }
            }
            await txManager.save(market_order_entity_1.MarketOrder, buyOrder);
        }
        // Update sell order
        sellOrder.escrowedItemQuantity = remainingSellQty;
        if (remainingSellQty === 0) {
            sellOrder.status = 'fulfilled';
        }
        await txManager.save(market_order_entity_1.MarketOrder, sellOrder);
        return deals;
    }
    /**
     * Internal: Release escrow (cancellation/expiry)
     */
    async releaseOrderEscrow(order, reason, txManager) {
        order.status = order.status === 'expired' ? 'expired' : 'cancelled';
        await txManager.save(market_order_entity_1.MarketOrder, order);
        if (order.type === 'sell') {
            // Return items to inventory
            if ((order.escrowedItemQuantity || 0) > 0) {
                let inventoryItem = await txManager.findOne(inventory_item_entity_1.InventoryItem, {
                    where: {
                        characterId: order.characterId,
                        itemId: order.itemId,
                        location: 'inventory',
                    },
                });
                if (inventoryItem) {
                    inventoryItem.quantity += (order.escrowedItemQuantity || 0);
                }
                else {
                    inventoryItem = this.inventoryRepo.create({
                        characterId: order.characterId,
                        itemId: order.itemId,
                        location: 'inventory',
                        slotIndex: -1,
                        quantity: (order.escrowedItemQuantity || 0),
                        instanceData: order.itemInstanceData,
                    });
                }
                await txManager.save(inventory_item_entity_1.InventoryItem, inventoryItem);
            }
        }
        else if (order.type === 'buy') {
            // Return gold
            const character = await txManager.findOne(character_entity_1.Character, {
                where: { id: order.characterId },
                lock: { mode: 'pessimistic_write' },
            });
            if (character && order.escrowedGold) {
                character.gold = (Number(character.gold) + Number(order.escrowedGold));
                await txManager.save(character_entity_1.Character, character);
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
        await txManager.save(mail_message_entity_1.MailMessage, mail);
        this.logger.debug(`Released escrow for order ${order.id}: ${reason}`);
    }
    /**
     * Get character's active orders
     */
    async getCharacterOrders(characterId) {
        return this.marketOrderRepo.find({
            where: { characterId, status: 'active' },
            order: { createdAt: 'DESC' },
        });
    }
    /**
     * Get character's deal history (last 15)
     */
    async getCharacterDeals(characterId) {
        return this.marketDealRepo.find({
            where: [
                { buyerCharacterId: characterId },
                { sellerCharacterId: characterId },
            ],
            order: { dealAt: 'DESC' },
            take: 15,
        });
    }
    /**
     * Get price history for an item
     */
    async getPriceHistory(itemId, days = 7) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const deals = await this.marketDealRepo.find({
            where: { itemId },
            order: { dealAt: 'ASC' },
        });
        const filtered = deals.filter(d => d.dealAt >= since);
        const byDay = {};
        for (const deal of filtered) {
            const day = deal.dealAt.toISOString().split('T')[0];
            if (!byDay[day])
                byDay[day] = [];
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
    async expireOrders() {
        return this.dataSource.transaction(async (txManager) => {
            const cutoff = new Date(Date.now() - this.ORDER_TTL_DAYS * 24 * 60 * 60 * 1000);
            const expiredOrders = await this.marketOrderRepo.find({
                where: { status: 'active', createdAt: (0, typeorm_2.LessThan)(cutoff) },
            });
            for (const order of expiredOrders) {
                order.status = 'expired';
                await this.releaseOrderEscrow(order, 'Market order expired (7 days)', txManager);
            }
            return expiredOrders.length;
        });
    }
};
exports.MarketService = MarketService;
exports.MarketService = MarketService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(market_order_entity_1.MarketOrder)),
    __param(1, (0, typeorm_1.InjectRepository)(market_deal_entity_1.MarketDeal)),
    __param(2, (0, typeorm_1.InjectRepository)(mail_message_entity_1.MailMessage)),
    __param(3, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(4, (0, typeorm_1.InjectRepository)(character_entity_1.Character)),
    __param(7, (0, common_1.Inject)(redis_provider_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService,
        gateway_service_1.GatewayService,
        ioredis_1.Redis,
        typeorm_2.DataSource])
], MarketService);
//# sourceMappingURL=market.service.js.map