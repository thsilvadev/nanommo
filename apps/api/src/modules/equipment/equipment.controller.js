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
exports.EquipmentController = void 0;
const common_1 = require("@nestjs/common");
const equipment_service_1 = require("./equipment.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let EquipmentController = class EquipmentController {
    equipmentService;
    constructor(equipmentService) {
        this.equipmentService = equipmentService;
    }
    /**
     * Get all equipped items for character
     */
    async getEquipment(req) {
        const characterId = req.user.characterId;
        return this.equipmentService.getEquipment(characterId);
    }
    /**
     * Get equipment loadout summary
     */
    async getLoadoutSummary(req) {
        const characterId = req.user.characterId;
        return this.equipmentService.getLoadoutSummary(characterId);
    }
    /**
     * Get item in specific slot
     */
    async getEquippedInSlot(req, slot) {
        const characterId = req.user.characterId;
        return this.equipmentService.getEquippedInSlot(characterId, slot);
    }
    /**
     * Get total stat bonuses from equipment
     */
    async getEquipmentStats(req) {
        const characterId = req.user.characterId;
        return this.equipmentService.calculateEquipmentStats(characterId);
    }
    /**
     * Equip an item
     */
    async equipItem(req, body) {
        const characterId = req.user.characterId;
        return this.equipmentService.equipItem(characterId, body.slot, body.itemId);
    }
    /**
     * Unequip an item
     */
    async unequipItem(req, slot) {
        const characterId = req.user.characterId;
        await this.equipmentService.unequipItem(characterId, slot);
        return { success: true };
    }
    /**
     * Validate weapon combination
     */
    async validateWeaponCombination(req, body) {
        const characterId = req.user.characterId;
        return this.equipmentService.validateWeaponCombination(characterId, body.mainWeapon, body.offHandWeapon);
    }
};
exports.EquipmentController = EquipmentController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EquipmentController.prototype, "getEquipment", null);
__decorate([
    (0, common_1.Get)('summary'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EquipmentController.prototype, "getLoadoutSummary", null);
__decorate([
    (0, common_1.Get)('slot/:slot'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('slot')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], EquipmentController.prototype, "getEquippedInSlot", null);
__decorate([
    (0, common_1.Get)('stats/total'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EquipmentController.prototype, "getEquipmentStats", null);
__decorate([
    (0, common_1.Put)('equip'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], EquipmentController.prototype, "equipItem", null);
__decorate([
    (0, common_1.Delete)('slot/:slot'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('slot')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], EquipmentController.prototype, "unequipItem", null);
__decorate([
    (0, common_1.Post)('validate-weapons'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], EquipmentController.prototype, "validateWeaponCombination", null);
exports.EquipmentController = EquipmentController = __decorate([
    (0, common_1.Controller)('equipment'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [equipment_service_1.EquipmentService])
], EquipmentController);
//# sourceMappingURL=equipment.controller.js.map