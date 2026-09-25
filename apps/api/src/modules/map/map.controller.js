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
exports.MapController = void 0;
const common_1 = require("@nestjs/common");
const map_service_1 = require("./map.service");
const character_service_1 = require("../character/character.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let MapController = class MapController {
    mapService;
    characterService;
    constructor(mapService, characterService) {
        this.mapService = mapService;
        this.characterService = characterService;
    }
    /**
     * Get all available maps
     */
    async getMaps() {
        return this.mapService.getMaps();
    }
    /**
     * Get maps recommended for character's level
     */
    async getRecommendedMaps(req) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            throw new common_1.BadRequestException('Character not found');
        return this.mapService.getRecommendedMaps(character.id);
    }
    /**
     * Enter a map
     */
    async enterMap(req, mapId) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            throw new common_1.BadRequestException('Character not found');
        await this.mapService.enterMap(character.id, mapId);
        return { success: true, currentMap: mapId };
    }
    /**
     * Leave current map
     */
    async leaveMap(req) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            throw new common_1.BadRequestException('Character not found');
        await this.mapService.leaveMap(character.id);
        return { success: true };
    }
    /**
     * Get kill counter for map
     */
    async getKillCounter(req, mapId) {
        const character = await this.characterService.getCharacterByUserId(req.user.userId);
        if (!character)
            throw new common_1.BadRequestException('Character not found');
        return this.mapService.getKillCounter(character.id, mapId);
    }
};
exports.MapController = MapController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MapController.prototype, "getMaps", null);
__decorate([
    (0, common_1.Get)('recommended'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MapController.prototype, "getRecommendedMaps", null);
__decorate([
    (0, common_1.Post)(':mapId/enter'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('mapId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MapController.prototype, "enterMap", null);
__decorate([
    (0, common_1.Post)('leave'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MapController.prototype, "leaveMap", null);
__decorate([
    (0, common_1.Get)(':mapId/kill-counter'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('mapId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MapController.prototype, "getKillCounter", null);
exports.MapController = MapController = __decorate([
    (0, common_1.Controller)('maps'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [map_service_1.MapService,
        character_service_1.CharacterService])
], MapController);
//# sourceMappingURL=map.controller.js.map