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
exports.MarketController = void 0;
const common_1 = require("@nestjs/common");
const market_service_1 = require("./market.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let MarketController = class MarketController {
    marketService;
    constructor(marketService) {
        this.marketService = marketService;
    }
    /**
     * Get all active orders for an item
     */
    async getMarketOrders(itemId) {
        return this.marketService.getMarketOrders(itemId);
    }
    /**
     * Get buy orders (highest bids) for an item
     */
    async getBuyOrders(itemId) {
        return this.marketService.getBuyOrders(itemId);
    }
    /**
     * Get sell orders (lowest asks) for an item
     */
    async getSellOrders(itemId) {
        return this.marketService.getSellOrders(itemId);
    }
    /**
     * Get price history for an item
     */
    async getPriceHistory(itemId, days = 7) {
        return this.marketService.getPriceHistory(itemId, days);
    }
    /**
     * Get character's active orders
     */
    async getCharacterOrders(req) {
        const characterId = req.user.characterId;
        return this.marketService.getCharacterOrders(characterId);
    }
    /**
     * Get character's completed deals
     */
    async getCharacterDeals(req) {
        const characterId = req.user.characterId;
        return this.marketService.getCharacterDeals(characterId);
    }
    /**
     * Place a buy order
     */
    async placeBuyOrder(req, body) {
        const characterId = req.user.characterId;
        return this.marketService.placeBuyOrder(characterId, body.itemId, body.quantity, body.pricePerUnit);
    }
    /**
     * Place a sell order
     */
    async placeSellOrder(req, body) {
        const characterId = req.user.characterId;
        return this.marketService.placeSellOrder(characterId, body.itemId, body.quantity, body.pricePerUnit, body.itemInstanceData);
    }
    /**
     * Cancel an order
     */
    async cancelOrder(req, orderId) {
        const characterId = req.user.characterId;
        await this.marketService.cancelOrder(orderId, characterId);
        return { success: true };
    }
};
exports.MarketController = MarketController;
__decorate([
    (0, common_1.Get)('orders/:itemId'),
    __param(0, (0, common_1.Param)('itemId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "getMarketOrders", null);
__decorate([
    (0, common_1.Get)('orders/:itemId/buy'),
    __param(0, (0, common_1.Param)('itemId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "getBuyOrders", null);
__decorate([
    (0, common_1.Get)('orders/:itemId/sell'),
    __param(0, (0, common_1.Param)('itemId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "getSellOrders", null);
__decorate([
    (0, common_1.Get)('history/:itemId'),
    __param(0, (0, common_1.Param)('itemId')),
    __param(1, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "getPriceHistory", null);
__decorate([
    (0, common_1.Get)('my-orders'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "getCharacterOrders", null);
__decorate([
    (0, common_1.Get)('my-deals'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "getCharacterDeals", null);
__decorate([
    (0, common_1.Post)('orders/buy'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "placeBuyOrder", null);
__decorate([
    (0, common_1.Post)('orders/sell'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "placeSellOrder", null);
__decorate([
    (0, common_1.Delete)('orders/:orderId'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MarketController.prototype, "cancelOrder", null);
exports.MarketController = MarketController = __decorate([
    (0, common_1.Controller)('market'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [market_service_1.MarketService])
], MarketController);
//# sourceMappingURL=market.controller.js.map