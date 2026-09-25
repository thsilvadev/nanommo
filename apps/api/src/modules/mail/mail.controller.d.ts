import { MailService } from './mail.service';
export declare class MailController {
    private readonly mailService;
    constructor(mailService: MailService);
    /**
     * Get inbox for character
     */
    getInbox(req: any): Promise<import("../../database/entities").MailMessage[]>;
    /**
     * Get unread mail count
     */
    getUnreadCount(req: any): Promise<{
        unreadCount: number;
    }>;
    /**
     * Get specific mail message
     */
    getMail(mailId: string): Promise<import("../../database/entities").MailMessage | null>;
    /**
     * Search mail
     */
    searchMail(req: any, query: string): Promise<import("../../database/entities").MailMessage[]>;
    /**
     * Send mail to another player
     */
    sendMail(req: any, body: {
        recipientName: string;
        subject: string;
        body: string;
        attachedGold?: number;
        attachedItemId?: string;
        attachedItemQuantity?: number;
    }): Promise<import("../../database/entities").MailMessage>;
    /**
     * Mark mail as read
     */
    markAsRead(mailId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Mark mail as unread
     */
    markAsUnread(mailId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Collect attachments from mail
     */
    collectAttachments(req: any, mailId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Delete mail
     */
    deleteMail(mailId: string): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=mail.controller.d.ts.map