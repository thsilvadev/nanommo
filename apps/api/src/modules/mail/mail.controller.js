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
exports.MailController = void 0;
const common_1 = require("@nestjs/common");
const mail_service_1 = require("./mail.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let MailController = class MailController {
    mailService;
    constructor(mailService) {
        this.mailService = mailService;
    }
    /**
     * Get inbox for character
     */
    async getInbox(req) {
        const characterId = req.user.characterId;
        return this.mailService.getInbox(characterId);
    }
    /**
     * Get unread mail count
     */
    async getUnreadCount(req) {
        const characterId = req.user.characterId;
        return { unreadCount: await this.mailService.getUnreadCount(characterId) };
    }
    /**
     * Get specific mail message
     */
    async getMail(mailId) {
        return this.mailService.getMail(mailId);
    }
    /**
     * Search mail
     */
    async searchMail(req, query) {
        const characterId = req.user.characterId;
        return this.mailService.searchMail(characterId, query);
    }
    /**
     * Send mail to another player
     */
    async sendMail(req, body) {
        const senderId = req.user.characterId;
        return this.mailService.sendMail(senderId, body.recipientName, body.subject, body.body, body.attachedGold, body.attachedItemId, body.attachedItemQuantity);
    }
    /**
     * Mark mail as read
     */
    async markAsRead(mailId) {
        await this.mailService.markAsRead(mailId);
        return { success: true };
    }
    /**
     * Mark mail as unread
     */
    async markAsUnread(mailId) {
        await this.mailService.markAsUnread(mailId);
        return { success: true };
    }
    /**
     * Collect attachments from mail
     */
    async collectAttachments(req, mailId) {
        const characterId = req.user.characterId;
        await this.mailService.collectAttachments(characterId, mailId);
        return { success: true };
    }
    /**
     * Delete mail
     */
    async deleteMail(mailId) {
        await this.mailService.deleteMail(mailId);
        return { success: true };
    }
};
exports.MailController = MailController;
__decorate([
    (0, common_1.Get)('inbox'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "getInbox", null);
__decorate([
    (0, common_1.Get)('unread-count'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "getUnreadCount", null);
__decorate([
    (0, common_1.Get)(':mailId'),
    __param(0, (0, common_1.Param)('mailId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "getMail", null);
__decorate([
    (0, common_1.Get)('search/:query'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('query')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "searchMail", null);
__decorate([
    (0, common_1.Post)('send'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "sendMail", null);
__decorate([
    (0, common_1.Post)(':mailId/read'),
    __param(0, (0, common_1.Param)('mailId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "markAsRead", null);
__decorate([
    (0, common_1.Post)(':mailId/unread'),
    __param(0, (0, common_1.Param)('mailId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "markAsUnread", null);
__decorate([
    (0, common_1.Post)(':mailId/collect'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('mailId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "collectAttachments", null);
__decorate([
    (0, common_1.Delete)(':mailId'),
    __param(0, (0, common_1.Param)('mailId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "deleteMail", null);
exports.MailController = MailController = __decorate([
    (0, common_1.Controller)('mail'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [mail_service_1.MailService])
], MailController);
//# sourceMappingURL=mail.controller.js.map