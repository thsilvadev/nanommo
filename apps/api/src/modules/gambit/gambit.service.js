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
exports.GambitService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const gambit_page_entity_1 = require("../../database/entities/gambit-page.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const data_service_1 = require("../data/data.service");
let GambitService = class GambitService {
    gambitPageRepo;
    characterRepo;
    dataService;
    constructor(gambitPageRepo, characterRepo, dataService) {
        this.gambitPageRepo = gambitPageRepo;
        this.characterRepo = characterRepo;
        this.dataService = dataService;
    }
    /**
     * Get all gambit pages for a character
     */
    async getGambitPages(characterId) {
        return this.gambitPageRepo.find({
            where: { character: { id: characterId } },
        });
    }
    /**
     * Get a specific gambit page
     */
    async getGambitPage(pageId) {
        return this.gambitPageRepo.findOneBy({ id: pageId });
    }
    /**
     * Create a new gambit page for a character
     */
    async createGambitPage(characterId, pageData) {
        // TODO: Implement gambit page creation
        // - Validate page structure
        // - Check max pages limit
        // - Create and save page
        throw new Error('Not implemented');
    }
    /**
     * Update a gambit page with validation
     */
    async updateGambitPage(pageId, pageData) {
        // TODO: Implement update
        // - Validate all gambit lines
        // - Check condition/action validity
        // - Update database
        throw new Error('Not implemented');
    }
    /**
     * Delete a gambit page
     */
    async deleteGambitPage(pageId) {
        await this.gambitPageRepo.delete(pageId);
    }
    /**
     * Validate a gambit line structure
     */
    async validateGambitLine(line) {
        // TODO: Implement validation
        // - Check condition exists in catalog
        // - Check action exists in catalog
        // - Validate parameters
        throw new Error('Not implemented');
    }
    /**
     * Get the active gambit page for a character
     */
    async getActiveGambitPage(characterId) {
        // TODO: Retrieve active/equipped gambit page
        throw new Error('Not implemented');
    }
    /**
     * Set the active gambit page
     */
    async setActiveGambitPage(characterId, pageId) {
        // TODO: Update active gambit reference
        throw new Error('Not implemented');
    }
};
exports.GambitService = GambitService;
exports.GambitService = GambitService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(gambit_page_entity_1.GambitPage)),
    __param(1, (0, typeorm_1.InjectRepository)(character_entity_1.Character)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService])
], GambitService);
//# sourceMappingURL=gambit.service.js.map