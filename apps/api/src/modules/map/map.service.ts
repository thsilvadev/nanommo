import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MapKillCounter, BattleQueueEntry, Character, User } from '../../database/entities';
import { DataService } from '../data/data.service';
import { BattleService } from '../battle/battle.service';
import { MapPresenceService } from '../presence/map-presence.service';
import { TOWN_MAP_ID } from '@nanommo/shared';

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);

  constructor(
    @InjectRepository(MapKillCounter)
    private readonly mapKillCounterRepo: Repository<MapKillCounter>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataService: DataService,
    private readonly battleService: BattleService,
    private readonly mapPresenceService: MapPresenceService,
  ) {}

  /**
   * Get all available maps
   */
  async getMaps(): Promise<any[]> {
    // Map topology and monster-presence weights have their own canonical catalogue.
    return this.dataService.getMaps();
  }

  /** Enter a revealed map. The Redis encounter-chain lock serializes competing clicks, queue generation and battle resolution. */
  async enterMap(characterId: string, mapId: string, requestedAt?: string): Promise<any> {
    const intentAt = Number.isFinite(Date.parse(String(requestedAt ?? '')))
      ? new Date(String(requestedAt)).toISOString()
      : new Date().toISOString();

    const result = await this.battleService.withCharacterQueueLock(characterId, async () => {
      const transition = await this.characterRepo.manager.transaction(async (manager) => {
        const characterRepo = manager.getRepository(Character);
        const queueRepo = manager.getRepository(BattleQueueEntry);
        const userRepo = manager.getRepository(User);
        const character = await characterRepo.findOne({
          where: { id: characterId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!character) throw new NotFoundException('Character not found');
        const map: any = this.dataService.getMapById(mapId);
        if (!map || map.isClickable === false) throw new BadRequestException('Map not found');
        if (map.type !== 'town' && map.type !== 'grind') throw new BadRequestException('Invalid map type');
        if (map.type === 'grind') {
          const user = await userRepo.findOne({ where: { id: character.userId } });
          if (user?.emailVerified !== true) throw new BadRequestException('EMAIL_NOT_VERIFIED');
        }

        const storedDiscovered = Array.isArray(character.discoveredMapIds) ? character.discoveredMapIds : [TOWN_MAP_ID];
        // Repair the known initial Town bootstrap if its only non-Town discovery is the unrelated Green Grounds 4.
        const persistedDiscovered = character.currentMapId === TOWN_MAP_ID && storedDiscovered.every(id => id === TOWN_MAP_ID || id === 'map_green_grounds_4')
          ? storedDiscovered.filter(id => id !== 'map_green_grounds_4') : storedDiscovered;
        const discovered = Array.from(new Set([...persistedDiscovered, character.currentMapId || TOWN_MAP_ID]));
        const discoveredMaps = discovered.map(id => this.dataService.getMapById(id)).filter(Boolean);
        const revealed = discoveredMaps.some((known: any) => Math.abs(Number(known.coordinates.x) - Number(map.coordinates.x)) + Math.abs(Number(known.coordinates.y) - Number(map.coordinates.y)) <= 1);
        if (!revealed) throw new BadRequestException('Map has not been revealed');

        if (map.type === 'grind') {
          const foodBuff = character.activeFoodBuff;
          if (!foodBuff?.expiresAt || new Date(foodBuff.expiresAt).getTime() <= Date.now()) {
            throw new BadRequestException('Town Guard: Your hungry! Eat something or go cleanse your sins for a change.');
          }
        }

        // Queue rows are authoritative and only unresolved entries are returned.
        // Keep a battle that has begun even when endAt passed but its resolver has not committed yet.
        const unresolved = await queueRepo.find({
          where: { characterId, resolved: false },
          order: { sequenceIndex: 'ASC' },
        });
        const now = Date.now();
        const active = unresolved.find(entry => new Date(entry.startAt).getTime() <= now);
        const previousMapId = character.currentMapId;

        if (active) {
          const existingRequestedAt = Date.parse(String(character.pendingMapTransition?.requestedAt ?? ''));
          const incomingRequestedAt = Date.parse(intentAt);
          if (character.pendingMapTransition && Number.isFinite(existingRequestedAt) && existingRequestedAt > incomingRequestedAt) {
            return {
              deferred: true,
              superseded: true,
              battleId: active.id,
              destinationMapId: character.pendingMapTransition.destinationMapId,
              character: {
                id: character.id, status: character.status, currentMapId: character.currentMapId,
                pendingMapTransition: character.pendingMapTransition, savedTownMapId: character.savedTownMapId ?? null,
                discoveredMapIds: character.discoveredMapIds,
              },
              previousMapId,
              cancelledBattleIds: [],
            };
          }
          const cancelledBattleIds = unresolved.filter(entry => entry.id !== active.id).map(entry => entry.id);
          if (cancelledBattleIds.length) {
            await queueRepo.delete({ id: In(cancelledBattleIds), resolved: false });
          }
          // CurrentMapId/status remain at the origin. Only the latest requested destination changes.
          if (this.dataService.getMapById(character.currentMapId)?.type === 'grind') character.status = 'grinding';
          character.pendingMapTransition = {
            destinationMapId: mapId,
            reason: map.type === 'town' ? 'town_request' : 'map_request',
            requestedAt: intentAt,
          };
          await characterRepo.save(character);
          return {
            deferred: true,
            superseded: false,
            battleId: active.id,
            destinationMapId: mapId,
            character: {
              id: character.id, status: character.status, currentMapId: character.currentMapId,
              pendingMapTransition: character.pendingMapTransition, savedTownMapId: character.savedTownMapId ?? null,
              discoveredMapIds: character.discoveredMapIds,
            },
            previousMapId,
            cancelledBattleIds,
            sourceWasGrind: this.dataService.getMapById(previousMapId)?.type === 'grind',
          };
        }

        // No begun unresolved battle remains. Delete future-start queue rows in this
        // transaction with the move and epoch reset, so no old-map projection survives a partial transition.
        const cancelledBattleIds = unresolved.map(entry => entry.id);
        if (cancelledBattleIds.length) {
          await queueRepo.delete({ id: In(cancelledBattleIds), resolved: false });
        }
        character.discoveredMapIds = Array.from(new Set([...discovered, mapId]));
        character.currentMapId = mapId;
        character.status = map.type === 'town' ? 'town' : 'grinding';
        character.pendingMapTransition = null;
        character.lastSeenAt = new Date();
        await characterRepo.save(character);

        // Any departure from a Grind map starts a fresh deterministic encounter epoch, including Grind -> Grind.
        if (previousMapId && previousMapId !== mapId && this.dataService.getMapById(previousMapId)?.type === 'grind') {
          await this.battleService.resetEncounterSequence(characterId, previousMapId, 'left map', manager);
        }
        return {
          deferred: false,
          superseded: false,
          battleId: null,
          destinationMapId: mapId,
          character: {
            id: character.id, status: character.status, currentMapId: character.currentMapId,
            pendingMapTransition: null, savedTownMapId: character.savedTownMapId ?? null,
            discoveredMapIds: character.discoveredMapIds,
          },
          previousMapId,
          cancelledBattleIds,
          sourceWasGrind: this.dataService.getMapById(previousMapId)?.type === 'grind',
          queueAfterLock: map.type === 'grind',
        };
      });

      // External queue/presence side effects follow the committed Character transition while the chain lock is still held.
      if (transition.superseded) return transition;
      if (transition.previousMapId) {
        try { await this.mapPresenceService.syncCharacter(characterId, transition.previousMapId); }
        catch (error) { this.logger.warn(`Map presence sync failed after map intent for ${characterId}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (transition.cancelledBattleIds?.length) {
        await this.battleService.removeBattleQueueJobs(transition.cancelledBattleIds);
      }
      return transition;
    });

    // Do not re-enter the same per-character lock. queueBattles reacquires it and
    // rereads the final authoritative map so a later click wins safely.
    if (!result.deferred && !result.superseded && result.queueAfterLock) {
      await this.battleService.queueBattles(characterId, 5);
    }
    this.logger.debug(`Character ${characterId} ${result.deferred ? 'requested' : 'entered'} map ${result.destinationMapId}`);
    return {
      deferred: result.deferred,
      superseded: result.superseded,
      battleId: result.battleId,
      destinationMapId: result.destinationMapId,
      character: result.character,
    };
  }

  /** Save the exact Town map the character is settled in as their teleport waypoint. */
  async saveCurrentTown(characterId: string): Promise<{ savedTownMapId: string }> {
    return this.battleService.withCharacterQueueLock(characterId, () => this.characterRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Character);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      if (this.dataService.getMapById(character.currentMapId)?.type !== 'town' || character.status !== 'town' || character.pendingMapTransition != null) {
        throw new BadRequestException('Save here is only available while settled in a Town');
      }
      character.savedTownMapId = character.currentMapId;
      await repo.save(character);
      return { savedTownMapId: character.currentMapId };
    }));
  }

  async leaveMap(characterId: string): Promise<any> {
    const character=await this.characterRepo.findOne({where:{id:characterId}});
    if(!character) throw new NotFoundException('Character not found');
    if(this.dataService.getMapById(character.currentMapId)?.type==='town') return {deferred:false,character:{id:character.id,status:'town',currentMapId:character.currentMapId,lastSeenAt:character.lastSeenAt}};
    return this.enterMap(characterId,TOWN_MAP_ID);
  }

  /**
   * Get kill counter for a character on a map
   */
  async getKillCounter(characterId: string, mapId: string): Promise<MapKillCounter | null> {
    return this.mapKillCounterRepo.findOne({
      where: { characterId, mapId },
    });
  }

  /**
   * Get recommended maps for a character's level
   */
  async getRecommendedMaps(characterId: string): Promise<any[]> {
    const character = await this.characterRepo.findOne({
      where: { id: characterId },
    });
    if (!character) throw new NotFoundException('Character not found');

    return (await this.getMaps()).filter(map => map.type === 'grind' && map.id !== TOWN_MAP_ID)
      .filter(map => Number(map.recommendedLevel ?? 1) <= Number(character.level) + 5)
      .sort((a,b)=>Math.abs(Number(a.recommendedLevel??1)-character.level)-Math.abs(Number(b.recommendedLevel??1)-character.level)).slice(0,5);
  }

  async incrementKillCounter(characterId: string, monsterId: string): Promise<number> {
    // TODO: Implement counter increment
    // - Find or create counter entry
    // - Increment count
    // - Return updated count
    throw new Error('Not implemented');
  }

  /**
   * Get map details with encounter rates
   */
  async getMapDetails(mapId: string): Promise<any> {
    // TODO: Return detailed map info with monster pool
    throw new Error('Not implemented');
  }

  /**
   * Validate character level for map
   */
  async validateMapAccess(characterId: string, mapId: string): Promise<{ allowed: boolean; reason?: string }> {
    // TODO: Check level/quest requirements
    throw new Error('Not implemented');
  }
}
