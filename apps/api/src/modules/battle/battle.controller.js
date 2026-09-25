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
exports.BattleController = void 0;
const common_1 = require("@nestjs/common");
const battle_service_1 = require("./battle.service");
const character_service_1 = require("../character/character.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let BattleController = class BattleController {
    battleService;
    characterService;
    constructor(battleService, characterService) {
        this.battleService = battleService;
        this.characterService = characterService;
    }
    /**
     * Get battle queue for authenticated user's character
     */
    async getQueue(req) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            throw new common_1.BadRequestException('Character not found');
        return this.battleService.getBattleQueue(character.id);
    }
    /**
     * Queue battles for the character (fill up to target depth)
     */
    async queueBattles(req) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            throw new common_1.BadRequestException('Character not found');
        return this.battleService.queueBattles(character.id, 5);
    }
    /**
     * Resolve a completed battle (called by scheduler)
     */
    async resolveBattle(battleId) {
        await this.battleService.resolveBattle(battleId);
        return { success: true };
    }
};
exports.BattleController = BattleController;
__decorate([
    (0, common_1.Get)('queue'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BattleController.prototype, "getQueue", null);
__decorate([
    (0, common_1.Post)('queue'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BattleController.prototype, "queueBattles", null);
__decorate([
    (0, common_1.Post)(':battleId/resolve'),
    __param(0, (0, common_1.Param)('battleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BattleController.prototype, "resolveBattle", null);
exports.BattleController = BattleController = __decorate([
    (0, common_1.Controller)('battles'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [battle_service_1.BattleService,
        character_service_1.CharacterService])
], BattleController);
//# sourceMappingURL=battle.controller.js.map