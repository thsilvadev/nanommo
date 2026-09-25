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
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const chat_service_1 = require("./chat.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let ChatController = class ChatController {
    chatService;
    constructor(chatService) {
        this.chatService = chatService;
    }
    /**
     * Get available chat channels
     */
    async getAvailableChannels() {
        return this.chatService.getAvailableChannels();
    }
    /**
     * Get chat history for a channel
     */
    async getChatHistory(channel, limit = 50) {
        return this.chatService.getChatHistory(channel, limit);
    }
    /**
     * Send chat message (REST fallback - Socket.IO preferred)
     */
    async sendChatMessage(req, body) {
        const characterId = req.user.characterId;
        await this.chatService.sendChatMessage(characterId, body.channel, body.message);
        return { success: true };
    }
    /**
     * Get muted players list
     */
    async getMutedPlayers(req) {
        const characterId = req.user.characterId;
        return this.chatService.getMutedPlayers(characterId);
    }
    /**
     * Mute a player
     */
    async mutePlayer(req, playerId, body) {
        const characterId = req.user.characterId;
        await this.chatService.mutePlayer(characterId, playerId, body.durationMinutes);
        return { success: true };
    }
    /**
     * Unmute a player
     */
    async unmutePlayer(req, playerId) {
        const characterId = req.user.characterId;
        await this.chatService.unmutePlayer(characterId, playerId);
        return { success: true };
    }
    /**
     * Report a chat message
     */
    async reportChatMessage(req, body) {
        const reporterId = req.user.characterId;
        return this.chatService.reportChatMessage(reporterId, body.reportedPlayerId, body.messageText, body.reason);
    }
    /**
     * Get chat reports (admin only)
     */
    async getChatReports(limit = 20) {
        // TODO: Add admin guard
        return this.chatService.getChatReports(limit);
    }
    /**
     * Resolve a chat report (admin only)
     */
    async resolveChatReport(reportId, body) {
        // TODO: Add admin guard
        await this.chatService.resolveChatReport(reportId, body.action, body.notes);
        return { success: true };
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Get)('channels'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getAvailableChannels", null);
__decorate([
    (0, common_1.Get)('history/:channel'),
    __param(0, (0, common_1.Param)('channel')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getChatHistory", null);
__decorate([
    (0, common_1.Post)('send'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "sendChatMessage", null);
__decorate([
    (0, common_1.Get)('muted'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getMutedPlayers", null);
__decorate([
    (0, common_1.Post)('mute/:playerId'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('playerId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "mutePlayer", null);
__decorate([
    (0, common_1.Post)('unmute/:playerId'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('playerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "unmutePlayer", null);
__decorate([
    (0, common_1.Post)('report'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "reportChatMessage", null);
__decorate([
    (0, common_1.Get)('reports'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getChatReports", null);
__decorate([
    (0, common_1.Post)('reports/:reportId/resolve'),
    __param(0, (0, common_1.Param)('reportId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "resolveChatReport", null);
exports.ChatController = ChatController = __decorate([
    (0, common_1.Controller)('chat'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [chat_service_1.ChatService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map