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
var MapService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../database/entities");
const data_service_1 = require("../data/data.service");
const battle_service_1 = require("../battle/battle.service");
let MapService = MapService_1 = class MapService {
    mapKillCounterRepo;
    characterRepo;
    dataService;
    battleService;
    logger = new common_1.Logger(MapService_1.name);
    constructor(mapKillCounterRepo, characterRepo, dataService, battleService) {
        this.mapKillCounterRepo = mapKillCounterRepo;
        this.characterRepo = characterRepo;
        this.dataService = dataService;
        this.battleService = battleService;
    }
    /**
     * Get all available maps
     */
    async getMaps() {
        const monsters = this.dataService.getMonsters();
        if (!monsters)
            return [];
        // Extract unique maps from monsters
        const mapsSet = new Set();
        const maps = [];
        if (Array.isArray(monsters)) {
            for (const monster of monsters) {
                if (monster.mapId && !mapsSet.has(monster.mapId)) {
                    mapsSet.add(monster.mapId);
                    const map = this.dataService.getMapById(monster.mapId);
                    if (map) {
                        maps.push(map);
                    }
                }
            }
        }
        return maps;
    }
    /**
     * Enter a map and start battles
     */
    async enterMap(characterId, mapId) {
        const character = await this.characterRepo.findOne({
            where: { id: characterId },
        });
        if (!character)
            throw new common_1.NotFoundException('Character not found');
        const map = this.dataService.getMapById(mapId);
        if (!map)
            throw new common_1.BadRequestException('Map not found');
        // Validate level requirement
        if (character.level < (map.unlockLevel || 1)) {
            throw new common_1.BadRequestException(`This map requires level ${map.unlockLevel}. You are level ${character.level}`);
        }
        // Update character status
        character.currentMapId = mapId;
        character.status = 'grinding';
        await this.characterRepo.save(character);
        // Queue initial battles
        await this.battleService.queueBattles(characterId, 5);
        this.logger.debug(`Character ${characterId} entered map ${mapId}`);
    }
    /**
     * Leave current map
     */
    async leaveMap(characterId) {
        const character = await this.characterRepo.findOne({
            where: { id: characterId },
        });
        if (!character)
            throw new common_1.NotFoundException('Character not found');
        character.currentMapId = undefined;
        character.status = 'town';
        await this.characterRepo.save(character);
        this.logger.debug(`Character ${characterId} left their map`);
    }
    /**
     * Get kill counter for a character on a map
     */
    async getKillCounter(characterId, mapId) {
        return this.mapKillCounterRepo.findOne({
            where: { characterId, mapId },
        });
    }
    /**
     * Get recommended maps for a character's level
     */
    async getRecommendedMaps(characterId) {
        const character = await this.characterRepo.findOne({
            where: { id: characterId },
        });
        if (!character)
            throw new common_1.NotFoundException('Character not found');
        const allMaps = await this.getMaps();
        // Filter maps that are accessible (within 5 levels)
        return allMaps.filter(map => {
            const minLevel = (map.unlockLevel || 1);
            const maxLevel = Math.min(minLevel + 10, 99);
            return character.level >= minLevel && character.level <= maxLevel;
        });
    }
    async incrementKillCounter(characterId, monsterId) {
        // TODO: Implement counter increment
        // - Find or create counter entry
        // - Increment count
        // - Return updated count
        throw new Error('Not implemented');
    }
    /**
     * Get map details with encounter rates
     */
    async getMapDetails(mapId) {
        // TODO: Return detailed map info with monster pool
        throw new Error('Not implemented');
    }
    /**
     * Validate character level for map
     */
    async validateMapAccess(characterId, mapId) {
        // TODO: Check level/quest requirements
        throw new Error('Not implemented');
    }
};
exports.MapService = MapService;
exports.MapService = MapService = MapService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.MapKillCounter)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.Character)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService,
        battle_service_1.BattleService])
], MapService);
//# sourceMappingURL=map.service.js.map