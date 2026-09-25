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
exports.GatewayService = void 0;
const common_1 = require("@nestjs/common");
const redis_provider_1 = require("../../config/redis.provider");
const ioredis_1 = require("ioredis");
/**
 * GatewayService — handles event emission and presence tracking
 * Injected into NanommoGateway for WebSocket emission
 * Also available to other modules (battle, chat, market) for event triggers
 */
let GatewayService = class GatewayService {
    redis;
    logger = new common_1.Logger('GatewayService');
    PRESENCE_EXPIRE_SECONDS = 3600; // 1 hour
    constructor(redis) {
        this.redis = redis;
    }
    /**
     * Emit battle:resolved event via Redis pub/sub to all instances
     * (Actual Socket.IO emission handled by gateway listening to this channel)
     */
    async publishBattleResolved(characterId, payload) {
        const channel = `gateway:battle:resolved:${characterId}`;
        await this.redis.publish(channel, JSON.stringify(payload));
        this.logger.debug(`Published battle:resolved for ${characterId}: ${payload.outcome}`);
    }
    /**
     * Emit character:leveledUp event
     */
    async publishCharacterLeveledUp(characterId, payload) {
        const channel = `gateway:character:leveledUp:${characterId}`;
        await this.redis.publish(channel, JSON.stringify(payload));
        this.logger.debug(`Published character:leveledUp for ${characterId}: level ${payload.newLevel}`);
    }
    /**
     * Emit character:died event
     */
    async publishCharacterDied(characterId, payload) {
        const channel = `gateway:character:died:${characterId}`;
        await this.redis.publish(channel, JSON.stringify(payload));
        this.logger.debug(`Published character:died for ${characterId}`);
    }
    /**
     * Emit battle:queueUpdated event
     */
    async publishBattleQueueUpdated(characterId, entries) {
        const channel = `gateway:battle:queueUpdated:${characterId}`;
        await this.redis.publish(channel, JSON.stringify({ entries }));
        this.logger.debug(`Published battle:queueUpdated for ${characterId}: ${entries.length} entries`);
    }
    /**
     * Update character presence in Redis
     */
    async updatePresence(characterId, location) {
        await this.redis.setex(`presence:${characterId}`, this.PRESENCE_EXPIRE_SECONDS, location);
    }
    /**
     * Add character to online set
     */
    async setOnline(characterId) {
        await this.redis.sadd('players:online', characterId);
    }
    /**
     * Remove character from online set
     */
    async setOffline(characterId) {
        await this.redis.srem('players:online', characterId);
        await this.redis.del(`presence:${characterId}`);
    }
    /**
     * Get online player count
     */
    async getOnlineCount() {
        return this.redis.scard('players:online');
    }
    /**
     * Get players on a specific map
     */
    async getPlayersOnMap(mapId) {
        return this.redis.hlen(`map:players:${mapId}`);
    }
    /**
     * Add player to map
     */
    async addPlayerToMap(characterId, mapId) {
        await this.redis.hset(`map:players:${mapId}`, characterId, Date.now());
    }
    /**
     * Remove player from map
     */
    async removePlayerFromMap(characterId, mapId) {
        await this.redis.hdel(`map:players:${mapId}`, characterId);
    }
    /**
     * Emit mail:newItem event
     */
    async publishMailNewItem(characterId, payload) {
        const channel = `gateway:mail:newItem:${characterId}`;
        await this.redis.publish(channel, JSON.stringify(payload));
        this.logger.debug(`Published mail:newItem for ${characterId}: ${payload.subject}`);
    }
    /**
     * Emit market:orderFilled event
     */
    async publishMarketOrderFilled(characterId, payload) {
        const channel = `gateway:market:orderFilled:${characterId}`;
        await this.redis.publish(channel, JSON.stringify(payload));
        this.logger.debug(`Published market:orderFilled for ${characterId}: ${payload.matchCount} matches`);
    }
};
exports.GatewayService = GatewayService;
exports.GatewayService = GatewayService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(redis_provider_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [ioredis_1.Redis])
], GatewayService);
//# sourceMappingURL=gateway.service.js.map