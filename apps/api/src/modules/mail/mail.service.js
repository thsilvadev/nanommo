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
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const mail_message_entity_1 = require("../../database/entities/mail-message.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const data_service_1 = require("../data/data.service");
let MailService = class MailService {
    mailRepo;
    characterRepo;
    dataService;
    constructor(mailRepo, characterRepo, dataService) {
        this.mailRepo = mailRepo;
        this.characterRepo = characterRepo;
        this.dataService = dataService;
    }
    /**
     * Get inbox for a character
     */
    async getInbox(characterId) {
        return this.mailRepo.find({
            where: { recipientCharacterId: characterId },
            order: { createdAt: 'DESC' },
        });
    }
    /**
     * Get unread mail count
     */
    async getUnreadCount(characterId) {
        return this.mailRepo.countBy({
            recipientCharacterId: characterId,
            collected: false,
        });
    }
    /**
     * Get a specific mail message
     */
    async getMail(mailId) {
        return this.mailRepo.findOneBy({ id: mailId });
    }
    /**
     * Send mail to another player
     */
    async sendMail(senderId, recipientName, subject, body, attachedGold, attachedItemId, attachedItemQuantity) {
        // TODO: Implement mail sending
        // - Validate recipient exists
        // - Validate sender has gold/items if attached
        // - Create mail message
        // - Lock gold/items in sender inventory
        throw new Error('Not implemented');
    }
    /**
     * Mark mail as read
     */
    async markAsRead(mailId) {
        await this.mailRepo.update(mailId, { collected: true });
    }
    /**
     * Mark mail as unread
     */
    async markAsUnread(mailId) {
        await this.mailRepo.update(mailId, { collected: false });
    }
    /**
     * Collect attachments from mail
     */
    async collectAttachments(characterId, mailId) {
        // TODO: Implement attachment collection
        // - Get mail
        // - Add gold to character
        // - Add items to inventory
        // - Mark as collected
        throw new Error('Not implemented');
    }
    /**
     * Delete mail
     */
    async deleteMail(mailId) {
        await this.mailRepo.delete(mailId);
    }
    /**
     * Expire old mail
     */
    async expireMail() {
        // TODO: Find and delete mail older than retention period
        // - Return count of deleted messages
        throw new Error('Not implemented');
    }
    /**
     * Send system mail (from NPC/system)
     */
    async sendSystemMail(recipientId, subject, body, attachedGold) {
        // TODO: Send mail from system account
        throw new Error('Not implemented');
    }
    /**
     * Search mail by subject or content
     */
    async searchMail(characterId, query) {
        // TODO: Implement mail search
        throw new Error('Not implemented');
    }
};
exports.MailService = MailService;
exports.MailService = MailService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(mail_message_entity_1.MailMessage)),
    __param(1, (0, typeorm_1.InjectRepository)(character_entity_1.Character)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService])
], MailService);
//# sourceMappingURL=mail.service.js.map