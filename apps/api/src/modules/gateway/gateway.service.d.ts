import { Redis } from 'ioredis';
export interface BattleResolvedPayload {
    entryId: string;
    outcome: 'victory' | 'defeat';
    xpGain: number;
    goldGain: number;
    drops: Array<{
        itemId: string;
        quantity: number;
    }>;
    characterAfter: {
        id: string;
        level: number;
        xp: number;
        hpCurrent: number;
        spCurrent: number;
        gold: number;
        status: string;
    };
}
export interface CharacterLeveledUpPayload {
    newLevel: number;
    unspentAttributePoints: number;
}
export interface CharacterDiedPayload {
    deathLog: any;
}
/**
 * GatewayService — handles event emission and presence tracking
 * Injected into NanommoGateway for WebSocket emission
 * Also available to other modules (battle, chat, market) for event triggers
 */
export declare class GatewayService {
    private readonly redis;
    private logger;
    private readonly PRESENCE_EXPIRE_SECONDS;
    constructor(redis: Redis);
    /**
     * Emit battle:resolved event via Redis pub/sub to all instances
     * (Actual Socket.IO emission handled by gateway listening to this channel)
     */
    publishBattleResolved(characterId: string, payload: BattleResolvedPayload): Promise<void>;
    /**
     * Emit character:leveledUp event
     */
    publishCharacterLeveledUp(characterId: string, payload: CharacterLeveledUpPayload): Promise<void>;
    /**
     * Emit character:died event
     */
    publishCharacterDied(characterId: string, payload: CharacterDiedPayload): Promise<void>;
    /**
     * Emit battle:queueUpdated event
     */
    publishBattleQueueUpdated(characterId: string, entries: any[]): Promise<void>;
    /**
     * Update character presence in Redis
     */
    updatePresence(characterId: string, location: string): Promise<void>;
    /**
     * Add character to online set
     */
    setOnline(characterId: string): Promise<void>;
    /**
     * Remove character from online set
     */
    setOffline(characterId: string): Promise<void>;
    /**
     * Get online player count
     */
    getOnlineCount(): Promise<number>;
    /**
     * Get players on a specific map
     */
    getPlayersOnMap(mapId: string): Promise<number>;
    /**
     * Add player to map
     */
    addPlayerToMap(characterId: string, mapId: string): Promise<void>;
    /**
     * Remove player from map
     */
    removePlayerFromMap(characterId: string, mapId: string): Promise<void>;
    /**
     * Emit mail:newItem event
     */
    publishMailNewItem(characterId: string, payload: {
        mailId: string;
        itemId?: string;
        quantity?: number;
        subject: string;
    }): Promise<void>;
    /**
     * Emit market:orderFilled event
     */
    publishMarketOrderFilled(characterId: string, payload: {
        orderId: string;
        type: 'buy' | 'sell';
        itemId: string;
        quantity: number;
        pricePerUnit: number;
        matchCount: number;
    }): Promise<void>;
}
//# sourceMappingURL=gateway.service.d.ts.map