import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Character } from '../../database/entities/character.entity';
import { User } from '../../database/entities/user.entity';
import { DataService } from '../data/data.service';
import { GatewayService } from './gateway.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  characterId?: string;
  username?: string;
  sessionId?: string;
}

// @WebSocketGateway({
//   namespace: '/game',
//   cors: {
//     origin: process.env.FRONTEND_URL || 'http://localhost:4200',
//     credentials: true,
//   },
// })
export class NanommoGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  // @WebSocketServer()
  server!: Server;

  private logger = new Logger('NanommoGateway');
  private connectedSockets = new Map<string, string>(); // charId -> socketId
  private redisSubscribers = new Map<string, any>(); // channel -> redis subscriber

  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataService: DataService,
    private readonly jwtService: JwtService,
    private readonly gatewayService: GatewayService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  afterInit(server: Server) {
    // Setup authentication middleware
    server.use(async (socket: AuthenticatedSocket, next) => {
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Auth failed: ${errorMessage}`);
        next(new Error(errorMessage === 'SESSION_INVALIDATED' ? 'SESSION_INVALIDATED' : 'Invalid token'));
      }
    });

    this.logger.log(
      `Gateway initialized on namespace ${process.env.WEBSOCKET_NAMESPACE || '/game'}`,
    );
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Get character for this user
      const character = await this.characterRepo.findOne({
        where: { userId: client.userId },
      });

      if (!character) {
        client.disconnect(true);
        this.logger.warn(
          `Connection rejected: no character for userId ${client.userId}`,
        );
        return;
      }

      client.characterId = character.id;
      this.connectedSockets.set(character.id, client.id);

      // Join private room for character
      client.join(`char:${character.id}`);

      // If grinding, join map room
      if (character.currentMapId && character.status === 'grinding') {
        client.join(`map:${character.currentMapId}`);
        await this.gatewayService.addPlayerToMap(
          character.id,
          character.currentMapId,
        );
      }

      // Subscribe to global chat rooms
      client.join('chat:global');
      client.join('chat:town');

      // Update presence in Redis
      await this.gatewayService.updatePresence(
        character.id,
        character.currentMapId || 'town',
      );
      await this.gatewayService.setOnline(character.id);

      // Setup Redis subscribers for this character's events
      this.setupRedisSubscribers(character.id, client);

      this.logger.log(
        `Character connected: ${character.name} (${character.id}) from IP ${client.handshake.address}`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Connection error: ${errorMessage}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    try {
      if (client.characterId) {
        const character = await this.characterRepo.findOne({
          where: { id: client.characterId },
        });

        if (character && character.currentMapId) {
          await this.gatewayService.removePlayerFromMap(
            client.characterId,
            character.currentMapId,
          );
        }

        this.connectedSockets.delete(client.characterId);

        // Cleanup Redis subscribers for this character
        this.cleanupRedisSubscribers(client.characterId);

        // Remove from online set
        await this.gatewayService.setOffline(client.characterId);

        this.logger.log(`Character disconnected: ${client.characterId}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Disconnect error: ${errorMessage}`);
    }
  }

  /**
   * Map:enter event — client requests to start grinding on a map
   */
  @SubscribeMessage('map:enter')
  async handleMapEnter(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { mapId: string },
  ) {
    try {
      const character = await this.characterRepo.findOne({
        where: { id: client.characterId },
      });

      if (!character) {
        throw new WsException('Character not found');
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
        await this.gatewayService.removePlayerFromMap(
          character.id,
          oldMapId,
        );
        client.leave(`map:${oldMapId}`);
      }

      await this.gatewayService.updatePresence(character.id, data.mapId);
      await this.gatewayService.addPlayerToMap(character.id, data.mapId);

      // Join new map room
      client.join(`map:${data.mapId}`);

      this.logger.debug(`Character ${character.name} entered map ${data.mapId}`);

      // TODO: Return battle queue entries
      client.emit('map:entered', { success: true, mapId: data.mapId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Map enter error: ${errorMessage}`);
      throw new WsException(errorMessage);
    }
  }

  /**
   * Map:leave event — client returns to town
   */
  @SubscribeMessage('map:leave')
  async handleMapLeave(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const character = await this.characterRepo.findOne({
        where: { id: client.characterId },
      });

      if (!character) {
        throw new WsException('Character not found');
      }

      const oldMapId = character.currentMapId;

      character.currentMapId = undefined;
      character.status = 'town';
      await this.characterRepo.save(character);

      // Update presence and map tracking
      await this.gatewayService.updatePresence(character.id, 'town');

      if (oldMapId) {
        await this.gatewayService.removePlayerFromMap(
          character.id,
          oldMapId,
        );
        client.leave(`map:${oldMapId}`);
      }

      this.logger.debug(`Character ${character.name} left map`);

      // TODO: Cancel pending queue entries beyond current

      client.emit('map:left', { success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Map leave error: ${errorMessage}`);
      throw new WsException(errorMessage);
    }
  }

  /**
   * Gambit:setActivePage event
   */
  @SubscribeMessage('gambit:setActivePage')
  async handleSetActivePage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { pageId: string },
  ) {
    try {
      const character = await this.characterRepo.findOne({
        where: { id: client.characterId },
      });

      if (!character) {
        throw new WsException('Character not found');
      }

      // TODO: Check if battle in flight, reject if so
      // TODO: Validate pageId exists and belongs to character

      character.activeGambitPageId = data.pageId;
      await this.characterRepo.save(character);

      this.logger.debug(
        `Character ${character.name} set active gambit page to ${data.pageId}`,
      );

      client.emit('gambit:pageSet', { success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Set active page error: ${errorMessage}`);
      throw new WsException(errorMessage);
    }
  }

  /**
   * Chat:send event
   */
  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { channel: 'global' | 'town'; message: string },
  ) {
    try {
      const character = await this.characterRepo.findOne({
        where: { id: client.characterId },
      });

      if (!character) {
        throw new WsException('Character not found');
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

      this.logger.debug(
        `Chat from ${character.name}: [${data.channel}] ${data.message}`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Chat send error: ${errorMessage}`);
      throw new WsException(errorMessage);
    }
  }

  /**
   * Chat:report event
   */
  @SubscribeMessage('chat:report')
  async handleChatReport(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { targetUserId: string; messageSnapshot: string },
  ) {
    try {
      // TODO: Store report in moderation queue
      this.logger.warn(
        `Chat report from ${client.characterId}: ${data.messageSnapshot}`,
      );
      client.emit('chat:reportAcknowledged', { success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Chat report error: ${errorMessage}`);
      throw new WsException(errorMessage);
    }
  }

  /**
   * Ping/pong for keep-alive
   */
  @SubscribeMessage('ping')
  async handlePing(@ConnectedSocket() client: Socket): Promise<string> {
    return 'pong';
  }

  // ========== REDIS SUBSCRIPTION SETUP ==========

  /**
   * Setup Redis subscribers for a character's events
   * Listens to Redis publish channels and forwards to Socket.IO
   */
  private setupRedisSubscribers(characterId: string, socket: Socket): void {
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
  private cleanupRedisSubscribers(characterId: string): void {
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
  isCharacterOnline(characterId: string): boolean {
    return this.connectedSockets.has(characterId);
  }

  /**
   * Get socket ID for a character (for targeted operations)
   */
  getSocketIdForCharacter(characterId: string): string | undefined {
    return this.connectedSockets.get(characterId);
  }

  /**
   * Get online player count
   */
  getOnlineCount(): number {
    return this.connectedSockets.size;
  }

  /**
   * Get list of online characters
   */
  getOnlineCharacters(): string[] {
    return Array.from(this.connectedSockets.keys());
  }
}
