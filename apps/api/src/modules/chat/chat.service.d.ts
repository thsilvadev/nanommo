import { Repository } from 'typeorm';
import { ChatReport } from '../../database/entities/chat-report.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
export declare class ChatService {
    private readonly chatReportRepo;
    private readonly characterRepo;
    private readonly dataService;
    constructor(chatReportRepo: Repository<ChatReport>, characterRepo: Repository<Character>, dataService: DataService);
    /**
     * Send chat message to a channel
     */
    sendChatMessage(characterId: string, channel: string, message: string): Promise<void>;
    /**
     * Get chat history for a channel
     */
    getChatHistory(channel: string, limit?: number): Promise<any[]>;
    /**
     * Mute a player
     */
    mutePlayer(characterId: string, mutedPlayerId: string, durationMinutes?: number): Promise<void>;
    /**
     * Unmute a player
     */
    unmutePlayer(characterId: string, mutedPlayerId: string): Promise<void>;
    /**
     * Get muted players list
     */
    getMutedPlayers(characterId: string): Promise<string[]>;
    /**
     * Report chat message
     */
    reportChatMessage(reporterId: string, reportedPlayerId: string, messageText: string, reason: string): Promise<ChatReport>;
    /**
     * Get chat reports (admin)
     */
    getChatReports(limit?: number): Promise<ChatReport[]>;
    /**
     * Resolve a chat report
     */
    resolveChatReport(reportId: string, action: string, notes: string): Promise<void>;
    /**
     * Check if player is muted by another
     */
    isPlayerMuted(characterId: string, speakerId: string): Promise<boolean>;
    /**
     * Get available chat channels
     */
    getAvailableChannels(): Promise<any[]>;
}
//# sourceMappingURL=chat.service.d.ts.map