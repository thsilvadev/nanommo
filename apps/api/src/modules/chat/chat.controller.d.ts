import { ChatService } from './chat.service';
export declare class ChatController {
    private readonly chatService;
    constructor(chatService: ChatService);
    /**
     * Get available chat channels
     */
    getAvailableChannels(): Promise<any[]>;
    /**
     * Get chat history for a channel
     */
    getChatHistory(channel: string, limit?: number): Promise<any[]>;
    /**
     * Send chat message (REST fallback - Socket.IO preferred)
     */
    sendChatMessage(req: any, body: {
        channel: string;
        message: string;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Get muted players list
     */
    getMutedPlayers(req: any): Promise<string[]>;
    /**
     * Mute a player
     */
    mutePlayer(req: any, playerId: string, body: {
        durationMinutes?: number;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Unmute a player
     */
    unmutePlayer(req: any, playerId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Report a chat message
     */
    reportChatMessage(req: any, body: {
        reportedPlayerId: string;
        messageText: string;
        reason: string;
    }): Promise<import("../../database/entities").ChatReport>;
    /**
     * Get chat reports (admin only)
     */
    getChatReports(limit?: number): Promise<import("../../database/entities").ChatReport[]>;
    /**
     * Resolve a chat report (admin only)
     */
    resolveChatReport(reportId: string, body: {
        action: string;
        notes: string;
    }): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=chat.controller.d.ts.map