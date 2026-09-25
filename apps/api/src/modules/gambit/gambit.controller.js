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
exports.GambitController = void 0;
const common_1 = require("@nestjs/common");
const gambit_service_1 = require("./gambit.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let GambitController = class GambitController {
    gambitService;
    constructor(gambitService) {
        this.gambitService = gambitService;
    }
    /**
     * Get all gambit pages for the character
     */
    async getGambitPages(req) {
        const characterId = req.user.characterId;
        return this.gambitService.getGambitPages(characterId);
    }
    /**
     * Get a specific gambit page
     */
    async getGambitPage(pageId) {
        return this.gambitService.getGambitPage(pageId);
    }
    /**
     * Create a new gambit page
     */
    async createGambitPage(req, pageData) {
        const characterId = req.user.characterId;
        return this.gambitService.createGambitPage(characterId, pageData);
    }
    /**
     * Update a gambit page
     */
    async updateGambitPage(pageId, pageData) {
        return this.gambitService.updateGambitPage(pageId, pageData);
    }
    /**
     * Delete a gambit page
     */
    async deleteGambitPage(pageId) {
        await this.gambitService.deleteGambitPage(pageId);
        return { success: true };
    }
    /**
     * Validate a gambit line
     */
    async validateGambitLine(line) {
        return this.gambitService.validateGambitLine(line);
    }
};
exports.GambitController = GambitController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GambitController.prototype, "getGambitPages", null);
__decorate([
    (0, common_1.Get)(':pageId'),
    __param(0, (0, common_1.Param)('pageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GambitController.prototype, "getGambitPage", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], GambitController.prototype, "createGambitPage", null);
__decorate([
    (0, common_1.Put)(':pageId'),
    __param(0, (0, common_1.Param)('pageId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], GambitController.prototype, "updateGambitPage", null);
__decorate([
    (0, common_1.Delete)(':pageId'),
    __param(0, (0, common_1.Param)('pageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GambitController.prototype, "deleteGambitPage", null);
__decorate([
    (0, common_1.Post)('validate-line'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GambitController.prototype, "validateGambitLine", null);
exports.GambitController = GambitController = __decorate([
    (0, common_1.Controller)('gambits'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [gambit_service_1.GambitService])
], GambitController);
//# sourceMappingURL=gambit.controller.js.map