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
import { Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Character } from '../../database/entities/character.entity';
import { User } from '../../database/entities/user.entity';
import { DataService } from '../data/data.service';
import { GatewayService } from './gateway.service';
import { MapService } from '../map/map.service';
import { BattleService } from '../battle/battle.service';
import { MapPresenceService } from '../presence/map-presence.service';
import { OnlinePresenceService } from '../presence/online-presence.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  characterId?: string;
  username?: string;
  sessionId?: string;
}

@WebSocketGateway({
  namespace: '/game',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    credentials: true,
  },
})
export class NanommoGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  // @WebSocketServer()
  server!: Server;

  private logger = new Logger('NanommoGateway');
  private connectedSockets = new Map<string, string>(); // charId -> socketId
  private redisSubscribers = new Map<string, any>(); // channel -> redis subscriber
  private mapPresenceSubscriber: Redis | null = null;

  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataService: DataService,
    private readonly jwtService: JwtService,
    private readonly gatewayService: GatewayService,
    private readonly mapService: MapService,
    private readonly battleService: BattleService,
    private readonly mapPresenceService: MapPresenceService,
    private readonly onlinePresenceService: OnlinePresenceService,
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

        const character = await this.characterRepo.findOne({
          where: { userId: payload.userId },
        });
        if (!character) {
          return next(new Error('CHARACTER_NOT_FOUND'));
        }

        socket.userId = payload.userId;
        socket.username = character.name;
        socket.sessionId = payload.sessionId;
        socket.characterId = character.id;
        next();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Auth failed: ${errorMessage}`);
        next(new Error(errorMessage === 'SESSION_INVALIDATED' ? 'SESSION_INVALIDATED' : 'Invalid token'));
      }
    });

    this.mapPresenceSubscriber = this.redis.duplicate();
    this.mapPresenceSubscriber.on('message', (channel, message) => {
      try {
        const payload = JSON.parse(message);
        if (channel === 'gateway:map:presence' && payload?.mapId) {
          this.server.to(`map:${payload.mapId}`).emit('map:presence', payload);
        }
        if (channel === 'gateway:map:transition' && payload?.characterId) {
          const socketId = this.connectedSockets.get(payload.characterId);
          if (socketId) {
            const socket = this.server.sockets.sockets.get(socketId);
            if (socket) {
              if (payload.previousMapId) socket.leave(`map:${payload.previousMapId}`);
              if (payload.nextMapId) {
                socket.join(`map:${payload.nextMapId}`);
                void this.mapPresenceService.getPlayersOnMap(payload.nextMapId).then(playersOnMap => {
                  socket.emit('map:presence', { mapId: payload.nextMapId, playersOnMap });
                });
              }
            }
          }
        }
      } catch {
        // Ignore malformed internal presence payloads; gameplay remains server-authoritative.
      }
    });
    this.mapPresenceSubscriber.subscribe('gateway:map:presence', 'gateway:map:transition');

    this.logger.log(
      `Gateway initialized on namespace ${process.env.WEBSOCKET_NAMESPACE || '/game'}`,
    );
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Get character for this user
      const character = client.characterId
        ? await this.characterRepo.findOne({ where: { id: client.characterId } })
        : await this.characterRepo.findOne({ where: { userId: client.userId } });

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

      // Reconcile this character's gameplay map presence before joining the map room.
      // The service uses the authoritative Character state; socket connectivity is not
      // itself a gameplay-presence signal.
      await this.mapPresenceService.syncCharacter(character.id, character.currentMapId ?? null);

      if (this.mapPresenceService.getActiveMapId(character)) {
        const activeMapId = this.mapPresenceService.getActiveMapId(character)!;
        client.join(`map:${activeMapId}`);
        client.emit('map:presence', {
          mapId: activeMapId,
          playersOnMap: await this.mapPresenceService.getPlayersOnMap(activeMapId),
        });
      }

      // Subscribe to global chat rooms
      client.join('chat:global');
      client.join('chat:town');

      // Online/socket presence is separate from gameplay map presence. This service
      // will later be refreshed by the reusable heartbeat for friends/online lists.
      await this.onlinePresenceService.updateLocation(
        character.id,
        character.currentMapId || 'town',
      );
      await this.onlinePresenceService.setOnline(character.id);

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
        // Socket disconnect is not a gameplay/map exit. A character that remains
        // grinding must continue counting in playersInMap even while offline.
        this.connectedSockets.delete(client.characterId);

        // Cleanup Redis subscribers for this character
        this.cleanupRedisSubscribers(client.characterId);

        // Remove from online set
        await this.onlinePresenceService.setOffline(client.characterId);

        this.logger.log(`Character disconnected: ${client.characterId}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Disconnect error: ${errorMessage}`);
    }
  }

  onModuleDestroy() {
    this.mapPresenceSubscriber?.disconnect();
    this.mapPresenceSubscriber = null;
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
      if (!data?.mapId) throw new WsException('mapId is required');
      if (!client.characterId) throw new WsException('Character not found');

      const character = await this.characterRepo.findOne({ where: { id: client.characterId } });
      if (!character) throw new WsException('Character not found');
      const oldMapId = character.currentMapId;

      await this.mapService.enterMap(character.id, data.mapId);

      if (oldMapId && oldMapId !== data.mapId) {
        client.leave(`map:${oldMapId}`);
      }

      await this.onlinePresenceService.updateLocation(character.id, data.mapId);
      client.join(`map:${data.mapId}`);
      client.emit('map:presence', {
        mapId: data.mapId,
        playersOnMap: await this.mapPresenceService.getPlayersOnMap(data.mapId),
      });

      client.emit('map:entered', { success: true, mapId: data.mapId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Map enter error: ${errorMessage}`);
      throw new WsException(errorMessage);
    }
  }

  @SubscribeMessage('map:syncPresence')
  async handleMapPresenceSync(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { mapId: string },
  ) {
    if (!client.characterId || !data?.mapId) throw new WsException('mapId is required');
    const character = await this.characterRepo.findOne({ where: { id: client.characterId } });
    if (!character) throw new WsException('Character not found');

    await this.mapPresenceService.syncCharacter(character.id, data.mapId);

    const activeMapId = this.mapPresenceService.getActiveMapId(character);
    if (activeMapId === data.mapId) {
      client.join(`map:${data.mapId}`);
    } else {
      client.leave(`map:${data.mapId}`);
    }

    client.emit('map:presence', {
      mapId: data.mapId,
      playersOnMap: await this.mapPresenceService.getPlayersOnMap(data.mapId),
    });
  }

  @SubscribeMessage('map:leave')
  async handleMapLeave(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      if (!client.characterId) throw new WsException('Character not found');
      const character = await this.characterRepo.findOne({ where: { id: client.characterId } });
      if (!character) throw new WsException('Character not found');

      const oldMapId = character.currentMapId;
      await this.mapService.leaveMap(character.id);

      await this.onlinePresenceService.updateLocation(character.id, 'town');
      if (oldMapId) {
        client.leave(`map:${oldMapId}`);
      }

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
