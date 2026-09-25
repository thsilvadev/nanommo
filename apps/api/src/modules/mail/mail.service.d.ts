import { Repository } from 'typeorm';
import { MailMessage } from '../../database/entities/mail-message.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
export declare class MailService {
    private readonly mailRepo;
    private readonly characterRepo;
    private readonly dataService;
    constructor(mailRepo: Repository<MailMessage>, characterRepo: Repository<Character>, dataService: DataService);
    /**
     * Get inbox for a character
     */
    getInbox(characterId: string): Promise<MailMessage[]>;
    /**
     * Get unread mail count
     */
    getUnreadCount(characterId: string): Promise<number>;
    /**
     * Get a specific mail message
     */
    getMail(mailId: string): Promise<MailMessage | null>;
    /**
     * Send mail to another player
     */
    sendMail(senderId: string, recipientName: string, subject: string, body: string, attachedGold?: number, attachedItemId?: string, attachedItemQuantity?: number): Promise<MailMessage>;
    /**
     * Mark mail as read
     */
    markAsRead(mailId: string): Promise<void>;
    /**
     * Mark mail as unread
     */
    markAsUnread(mailId: string): Promise<void>;
    /**
     * Collect attachments from mail
     */
    collectAttachments(characterId: string, mailId: string): Promise<void>;
    /**
     * Delete mail
     */
    deleteMail(mailId: string): Promise<void>;
    /**
     * Expire old mail
     */
    expireMail(): Promise<number>;
    /**
     * Send system mail (from NPC/system)
     */
    sendSystemMail(recipientId: string, subject: string, body: string, attachedGold?: number): Promise<MailMessage>;
    /**
     * Search mail by subject or content
     */
    searchMail(characterId: string, query: string): Promise<MailMessage[]>;
}
//# sourceMappingURL=mail.service.d.ts.map