import { OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Character } from '../../database/entities/character.entity';
import { User } from '../../database/entities/user.entity';
import { DataService } from '../data/data.service';
import { GatewayService } from './gateway.service';
import { Redis } from 'ioredis';
interface AuthenticatedSocket extends Socket {
    userId?: string;
    characterId?: string;
    username?: string;
    sessionId?: string;
}
export declare class NanommoGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly characterRepo;
    private readonly userRepo;
    private readonly dataService;
    private readonly jwtService;
    private readonly gatewayService;
    private readonly redis;
    server: Server;
    private logger;
    private connectedSockets;
    private redisSubscribers;
    constructor(characterRepo: Repository<Character>, userRepo: Repository<User>, dataService: DataService, jwtService: JwtService, gatewayService: GatewayService, redis: Redis);
    afterInit(server: Server): void;
    handleConnection(client: AuthenticatedSocket): Promise<void>;
    handleDisconnect(client: AuthenticatedSocket): Promise<void>;
    /**
     * Map:enter event — client requests to start grinding on a map
     */
    handleMapEnter(client: AuthenticatedSocket, data: {
        mapId: string;
    }): Promise<void>;
    /**
     * Map:leave event — client returns to town
     */
    handleMapLeave(client: AuthenticatedSocket): Promise<void>;
    /**
     * Gambit:setActivePage event
     */
    handleSetActivePage(client: AuthenticatedSocket, data: {
        pageId: string;
    }): Promise<void>;
    /**
     * Chat:send event
     */
    handleChatSend(client: AuthenticatedSocket, data: {
        channel: 'global' | 'town';
        message: string;
    }): Promise<void>;
    /**
     * Chat:report event
     */
    handleChatReport(client: AuthenticatedSocket, data: {
        targetUserId: string;
        messageSnapshot: string;
    }): Promise<void>;
    /**
     * Ping/pong for keep-alive
     */
    handlePing(client: Socket): Promise<string>;
    /**
     * Setup Redis subscribers for a character's events
     * Listens to Redis publish channels and forwards to Socket.IO
     */
    private setupRedisSubscribers;
    /**
     * Cleanup Redis subscribers for a character
     */
    private cleanupRedisSubscribers;
    /**
     * Get online status of a character
     */
    isCharacterOnline(characterId: string): boolean;
    /**
     * Get socket ID for a character (for targeted operations)
     */
    getSocketIdForCharacter(characterId: string): string | undefined;
    /**
     * Get online player count
     */
    getOnlineCount(): number;
    /**
     * Get list of online characters
     */
    getOnlineCharacters(): string[];
}
export {};
//# sourceMappingURL=nanommo.gateway.d.ts.map