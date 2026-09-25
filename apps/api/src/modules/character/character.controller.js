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
exports.CharacterController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const character_service_1 = require("./character.service");
const shared_1 = require("@nanommo/shared");
let CharacterController = class CharacterController {
    characterService;
    constructor(characterService) {
        this.characterService = characterService;
    }
    async create(req, dto) {
        return this.characterService.createCharacter(req.user.userId, dto.username);
    }
    async getMyCharacter(req) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            return null;
        return {
            id: character.id,
            userId: character.userId,
            name: character.name,
            level: character.level,
            xp: character.xp,
            unspentAttributePoints: character.unspentAttributePoints,
            str: character.str,
            agi: character.agi,
            dex: character.dex,
            vit: character.vit,
            int: character.int,
            sor: character.sor,
            gold: Number(character.gold),
            hpCurrent: character.hpCurrent,
            spCurrent: character.spCurrent,
            currentMapId: character.currentMapId || undefined,
            status: character.status,
            activeGambitPageId: character.activeGambitPageId || undefined,
            lastSeenAt: character.lastSeenAt,
            createdAt: character.createdAt,
            updatedAt: character.updatedAt,
        };
    }
    async spendAttributes(req, dto) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            throw new Error('Character not found');
        return this.characterService.spendAttributePoints(character.id, dto.attributes);
    }
};
exports.CharacterController = CharacterController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, shared_1.CreateCharacterDto]),
    __metadata("design:returntype", Promise)
], CharacterController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CharacterController.prototype, "getMyCharacter", null);
__decorate([
    (0, common_1.Post)('attributes/spend'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, shared_1.SpendAttributePointsDto]),
    __metadata("design:returntype", Promise)
], CharacterController.prototype, "spendAttributes", null);
exports.CharacterController = CharacterController = __decorate([
    (0, common_1.Controller)('characters'),
    __metadata("design:paramtypes", [character_service_1.CharacterService])
], CharacterController);
//# sourceMappingURL=character.controller.js.map