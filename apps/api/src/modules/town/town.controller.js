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
exports.TownController = void 0;
const common_1 = require("@nestjs/common");
const town_service_1 = require("./town.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let TownController = class TownController {
    townService;
    constructor(townService) {
        this.townService = townService;
    }
    /**
     * Get vendor NPC catalog
     */
    async getVendorCatalog() {
        return this.townService.getVendorCatalog();
    }
    /**
     * Get stock for a specific vendor
     */
    async getVendorStock(vendorId) {
        return this.townService.getVendorStock(vendorId);
    }
    /**
     * Buy item from vendor
     */
    async buyFromVendor(req, vendorId, body) {
        const characterId = req.user.characterId;
        await this.townService.buyFromVendor(characterId, vendorId, body.itemId, body.quantity);
        return { success: true };
    }
    /**
     * Get warehouse contents
     */
    async getWarehouse(req) {
        const characterId = req.user.characterId;
        return this.townService.getWarehouse(characterId);
    }
    /**
     * Get warehouse capacity info
     */
    async getWarehouseCapacity(req) {
        const characterId = req.user.characterId;
        return this.townService.getWarehouseCapacity(characterId);
    }
    /**
     * Deposit item to warehouse
     */
    async depositToWarehouse(req, body) {
        const characterId = req.user.characterId;
        await this.townService.depositToWarehouse(characterId, body.itemId, body.quantity);
        return { success: true };
    }
    /**
     * Withdraw item from warehouse
     */
    async withdrawFromWarehouse(req, body) {
        const characterId = req.user.characterId;
        await this.townService.withdrawFromWarehouse(characterId, body.itemId, body.quantity);
        return { success: true };
    }
    /**
     * Get list of town NPCs
     */
    async getTownNPCs() {
        return this.townService.getTownNPCs();
    }
    /**
     * Interact with NPC
     */
    async interactWithNPC(npcId, body) {
        return this.townService.interactWithNPC(npcId, body.action);
    }
    /**
     * Get town news/announcements
     */
    async getTownNews() {
        return this.townService.getTownNews();
    }
};
exports.TownController = TownController;
__decorate([
    (0, common_1.Get)('vendor/catalog'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TownController.prototype, "getVendorCatalog", null);
__decorate([
    (0, common_1.Get)('vendor/:vendorId/stock'),
    __param(0, (0, common_1.Param)('vendorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TownController.prototype, "getVendorStock", null);
__decorate([
    (0, common_1.Post)('vendor/:vendorId/buy'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('vendorId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], TownController.prototype, "buyFromVendor", null);
__decorate([
    (0, common_1.Get)('warehouse/contents'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TownController.prototype, "getWarehouse", null);
__decorate([
    (0, common_1.Get)('warehouse/capacity'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TownController.prototype, "getWarehouseCapacity", null);
__decorate([
    (0, common_1.Post)('warehouse/deposit'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TownController.prototype, "depositToWarehouse", null);
__decorate([
    (0, common_1.Post)('warehouse/withdraw'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TownController.prototype, "withdrawFromWarehouse", null);
__decorate([
    (0, common_1.Get)('npcs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TownController.prototype, "getTownNPCs", null);
__decorate([
    (0, common_1.Post)('npcs/:npcId/interact'),
    __param(0, (0, common_1.Param)('npcId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TownController.prototype, "interactWithNPC", null);
__decorate([
    (0, common_1.Get)('news'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TownController.prototype, "getTownNews", null);
exports.TownController = TownController = __decorate([
    (0, common_1.Controller)('town'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [town_service_1.TownService])
], TownController);
//# sourceMappingURL=town.controller.js.map