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
exports.InventoryController = void 0;
const common_1 = require("@nestjs/common");
const inventory_service_1 = require("./inventory.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let InventoryController = class InventoryController {
    inventoryService;
    constructor(inventoryService) {
        this.inventoryService = inventoryService;
    }
    /**
     * Get full inventory for character
     */
    async getInventory(req) {
        const characterId = req.user.characterId;
        return this.inventoryService.getInventory(characterId);
    }
    /**
     * Get warehouse items for character
     */
    async getWarehouse(req) {
        const characterId = req.user.characterId;
        return this.inventoryService.getWarehouse(characterId);
    }
    /**
     * Get count of a specific item
     */
    async getItemCount(req, itemId) {
        const characterId = req.user.characterId;
        return { count: await this.inventoryService.getItemCount(characterId, itemId) };
    }
    /**
     * Add item to inventory
     */
    async addItem(req, body) {
        const characterId = req.user.characterId;
        return this.inventoryService.addItem(characterId, body.itemId, body.quantity);
    }
    /**
     * Remove item from inventory
     */
    async removeItem(req, body) {
        const characterId = req.user.characterId;
        await this.inventoryService.removeItem(characterId, body.itemId, body.quantity);
        return { success: true };
    }
    /**
     * Transfer item to warehouse
     */
    async transferToWarehouse(req, body) {
        const characterId = req.user.characterId;
        await this.inventoryService.transferToWarehouse(characterId, body.itemId, body.quantity);
        return { success: true };
    }
    /**
     * Transfer item from warehouse
     */
    async transferFromWarehouse(req, body) {
        const characterId = req.user.characterId;
        await this.inventoryService.transferFromWarehouse(characterId, body.itemId, body.quantity);
        return { success: true };
    }
    /**
     * Sell item(s) to vendor
     */
    async sellToVendor(req, body) {
        const characterId = req.user.characterId;
        const goldReceived = await this.inventoryService.sellToVendor(characterId, body.itemId, body.quantity);
        return { goldReceived };
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "getInventory", null);
__decorate([
    (0, common_1.Get)('warehouse'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "getWarehouse", null);
__decorate([
    (0, common_1.Get)('item/:itemId/count'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('itemId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "getItemCount", null);
__decorate([
    (0, common_1.Post)('add'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "addItem", null);
__decorate([
    (0, common_1.Post)('remove'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "removeItem", null);
__decorate([
    (0, common_1.Post)('to-warehouse'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "transferToWarehouse", null);
__decorate([
    (0, common_1.Post)('from-warehouse'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "transferFromWarehouse", null);
__decorate([
    (0, common_1.Post)('sell'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InventoryController.prototype, "sellToVendor", null);
exports.InventoryController = InventoryController = __decorate([
    (0, common_1.Controller)('inventory'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [inventory_service_1.InventoryService])
], InventoryController);
//# sourceMappingURL=inventory.controller.js.map