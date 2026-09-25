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
exports.NanommoGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const character_entity_1 = require("../../database/entities/character.entity");
const user_entity_1 = require("../../database/entities/user.entity");
const data_service_1 = require("../data/data.service");
const gateway_service_1 = require("./gateway.service");
const redis_provider_1 = require("../../config/redis.provider");
const ioredis_1 = require("ioredis");
let NanommoGateway = class NanommoGateway {
    characterRepo;
    userRepo;
    dataService;
    jwtService;
    gatewayService;
    redis;
    server;
    logger = new common_1.Logger('NanommoGateway');
    connectedSockets = new Map(); // charId -> socketId
    redisSubscribers = new Map(); // channel -> redis subscriber
    constructor(characterRepo, userRepo, dataService, jwtService, gatewayService, redis) {
        this.characterRepo = characterRepo;
        this.userRepo = userRepo;
        this.dataService = dataService;
        this.jwtService = jwtService;
        this.gatewayService = gatewayService;
        this.redis = redis;
    }
    afterInit(server) {
        // Setup authentication middleware
        server.use(async (socket, next) => {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Missing auth token'));
            }
            try {
                const payload = this.jwtService.verify(token);
                // Validate sessionId exists in token
                if (!payload.sessionId) {
                    return next(new Error('SESSION_INVALIDATED'));
                }
                // Fetch user to validate sessionId matches
                const user = await this.userRepo.findOne({ where: { id: payload.userId } });
                if (!user || user.activeSessionId !== payload.sessionId) {
                    return next(new Error('SESSION_INVALIDATED'));
                }
                socket.userId = payload.userId;
                socket.username = payload.username;
                socket.sessionId = payload.sessionId;
                next();
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Auth failed: ${errorMessage}`);
                next(new Error(errorMessage === 'SESSION_INVALIDATED' ? 'SESSION_INVALIDATED' : 'Invalid token'));
            }
        });
        this.logger.log(`Gateway initialized on namespace ${process.env.WEBSOCKET_NAMESPACE || '/game'}`);
    }
    async handleConnection(client) {
        try {
            // Get character for this user
            const character = await this.characterRepo.findOne({
                where: { userId: client.userId },
            });
            if (!character) {
                client.disconnect(true);
                this.logger.warn(`Connection rejected: no character for userId ${client.userId}`);
                return;
            }
            client.characterId = character.id;
            this.connectedSockets.set(character.id, client.id);
            // Join private room for character
            client.join(`char:${character.id}`);
            // If grinding, join map room
            if (character.currentMapId && character.status === 'grinding') {
                client.join(`map:${character.currentMapId}`);
                await this.gatewayService.addPlayerToMap(character.id, character.currentMapId);
            }
            // Subscribe to global chat rooms
            client.join('chat:global');
            client.join('chat:town');
            // Update presence in Redis
            await this.gatewayService.updatePresence(character.id, character.currentMapId || 'town');
            await this.gatewayService.setOnline(character.id);
            // Setup Redis subscribers for this character's events
            this.setupRedisSubscribers(character.id, client);
            this.logger.log(`Character connected: ${character.name} (${character.id}) from IP ${client.handshake.address}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Connection error: ${errorMessage}`);
            client.disconnect(true);
        }
    }
    async handleDisconnect(client) {
        try {
            if (client.characterId) {
                const character = await this.characterRepo.findOne({
                    where: { id: client.characterId },
                });
                if (character && character.currentMapId) {
                    await this.gatewayService.removePlayerFromMap(client.characterId, character.currentMapId);
                }
                this.connectedSockets.delete(client.characterId);
                // Cleanup Redis subscribers for this character
                this.cleanupRedisSubscribers(client.characterId);
                // Remove from online set
                await this.gatewayService.setOffline(client.characterId);
                this.logger.log(`Character disconnected: ${client.characterId}`);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Disconnect error: ${errorMessage}`);
        }
    }
    /**
     * Map:enter event — client requests to start grinding on a map
     */
    async handleMapEnter(client, data) {
        try {
            const character = await this.characterRepo.findOne({
                where: { id: client.characterId },
            });
            if (!character) {
                throw new websockets_1.WsException('Character not found');
            }
            // TODO: Validate map exists and level requirement met
            // TODO: Build fresh battle queue via BattleService
            // TODO: Calculate playersOnMap from Redis
            const oldMapId = character.currentMapId;
            character.currentMapId = data.mapId;
            character.status = 'grinding';
            await this.characterRepo.save(character);
            // Update presence and map tracking
            if (oldMapId) {
                await this.gatewayService.removePlayerFromMap(character.id, oldMapId);
                client.leave(`map:${oldMapId}`);
            }
            await this.gatewayService.updatePresence(character.id, data.mapId);
            await this.gatewayService.addPlayerToMap(character.id, data.mapId);
            // Join new map room
            client.join(`map:${data.mapId}`);
            this.logger.debug(`Character ${character.name} entered map ${data.mapId}`);
            // TODO: Return battle queue entries
            client.emit('map:entered', { success: true, mapId: data.mapId });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Map enter error: ${errorMessage}`);
            throw new websockets_1.WsException(errorMessage);
        }
    }
    /**
     * Map:leave event — client returns to town
     */
    async handleMapLeave(client) {
        try {
            const character = await this.characterRepo.findOne({
                where: { id: client.characterId },
            });
            if (!character) {
                throw new websockets_1.WsException('Character not found');
            }
            const oldMapId = character.currentMapId;
            character.currentMapId = undefined;
            character.status = 'town';
            await this.characterRepo.save(character);
            // Update presence and map tracking
            await this.gatewayService.updatePresence(character.id, 'town');
            if (oldMapId) {
                await this.gatewayService.removePlayerFromMap(character.id, oldMapId);
                client.leave(`map:${oldMapId}`);
            }
            this.logger.debug(`Character ${character.name} left map`);
            // TODO: Cancel pending queue entries beyond current
            client.emit('map:left', { success: true });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Map leave error: ${errorMessage}`);
            throw new websockets_1.WsException(errorMessage);
        }
    }
    /**
     * Gambit:setActivePage event
     */
    async handleSetActivePage(client, data) {
        try {
            const character = await this.characterRepo.findOne({
                where: { id: client.characterId },
            });
            if (!character) {
                throw new websockets_1.WsException('Character not found');
            }
            // TODO: Check if battle in flight, reject if so
            // TODO: Validate pageId exists and belongs to character
            character.activeGambitPageId = data.pageId;
            await this.characterRepo.save(character);
            this.logger.debug(`Character ${character.name} set active gambit page to ${data.pageId}`);
            client.emit('gambit:pageSet', { success: true });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Set active page error: ${errorMessage}`);
            throw new websockets_1.WsException(errorMessage);
        }
    }
    /**
     * Chat:send event
     */
    async handleChatSend(client, data) {
        try {
            const character = await this.characterRepo.findOne({
                where: { id: client.characterId },
            });
            if (!character) {
                throw new websockets_1.WsException('Character not found');
            }
            // TODO: Validate message length
            // TODO: Rate limit check
            // TODO: Mute list check
            // TODO: Store in history
            const room = `chat:${data.channel}`;
            this.server.to(room).emit('chat:message', {
                channel: data.channel,
                username: character.name,
                message: data.message,
                sentAt: new Date(),
            });
            this.logger.debug(`Chat from ${character.name}: [${data.channel}] ${data.message}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Chat send error: ${errorMessage}`);
            throw new websockets_1.WsException(errorMessage);
        }
    }
    /**
     * Chat:report event
     */
    async handleChatReport(client, data) {
        try {
            // TODO: Store report in moderation queue
            this.logger.warn(`Chat report from ${client.characterId}: ${data.messageSnapshot}`);
            client.emit('chat:reportAcknowledged', { success: true });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Chat report error: ${errorMessage}`);
            throw new websockets_1.WsException(errorMessage);
        }
    }
    /**
     * Ping/pong for keep-alive
     */
    async handlePing(client) {
        return 'pong';
    }
    // ========== REDIS SUBSCRIPTION SETUP ==========
    /**
     * Setup Redis subscribers for a character's events
     * Listens to Redis publish channels and forwards to Socket.IO
     */
    setupRedisSubscribers(characterId, socket) {
        const channels = [
            `gateway:battle:resolved:${characterId}`,
            `gateway:character:leveledUp:${characterId}`,
            `gateway:character:died:${characterId}`,
            `gateway:battle:queueUpdated:${characterId}`,
            `gateway:mail:newItem:${characterId}`,
            `gateway:market:orderFilled:${characterId}`,
        ];
        channels.forEach((channel) => {
            const subscriber = this.redis.duplicate();
            subscriber.on('message', (_, message) => {
                const payload = JSON.parse(message);
                const eventName = channel.split(':').slice(1, -1).join(':');
                socket.emit(eventName, payload);
                this.logger.debug(`Forwarded ${eventName} to ${characterId}`);
            });
            subscriber.subscribe(channel, (err) => {
                if (err) {
                    this.logger.error(`Failed to subscribe to ${channel}: ${err}`);
                }
            });
            this.redisSubscribers.set(channel, subscriber);
        });
    }
    /**
     * Cleanup Redis subscribers for a character
     */
    cleanupRedisSubscribers(characterId) {
        const channelPrefix = `gateway:`;
        const channelSuffix = `:${characterId}`;
        for (const [channel, subscriber] of this.redisSubscribers.entries()) {
            if (channel.startsWith(channelPrefix) && channel.endsWith(channelSuffix)) {
                subscriber.unsubscribe();
                subscriber.quit();
                this.redisSubscribers.delete(channel);
            }
        }
    }
    // ========== UTILITY METHODS ==========
    /**
     * Get online status of a character
     */
    isCharacterOnline(characterId) {
        return this.connectedSockets.has(characterId);
    }
    /**
     * Get socket ID for a character (for targeted operations)
     */
    getSocketIdForCharacter(characterId) {
        return this.connectedSockets.get(characterId);
    }
    /**
     * Get online player count
     */
    getOnlineCount() {
        return this.connectedSockets.size;
    }
    /**
     * Get list of online characters
     */
    getOnlineCharacters() {
        return Array.from(this.connectedSockets.keys());
    }
};
exports.NanommoGateway = NanommoGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], NanommoGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('map:enter'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NanommoGateway.prototype, "handleMapEnter", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('map:leave'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NanommoGateway.prototype, "handleMapLeave", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('gambit:setActivePage'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NanommoGateway.prototype, "handleSetActivePage", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('chat:send'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NanommoGateway.prototype, "handleChatSend", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('chat:report'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NanommoGateway.prototype, "handleChatReport", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('ping'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], NanommoGateway.prototype, "handlePing", null);
exports.NanommoGateway = NanommoGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({
        namespace: '/game',
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:4200',
            credentials: true,
        },
    }),
    __param(0, (0, typeorm_1.InjectRepository)(character_entity_1.Character)),
    __param(1, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __param(5, (0, common_1.Inject)(redis_provider_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService,
        jwt_1.JwtService,
        gateway_service_1.GatewayService,
        ioredis_1.Redis])
], NanommoGateway);
//# sourceMappingURL=nanommo.gateway.js.map