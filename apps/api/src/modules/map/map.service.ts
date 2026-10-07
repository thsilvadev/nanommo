import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MapKillCounter, Character, User } from '../../database/entities';
import { DataService } from '../data/data.service';
import { BattleService } from '../battle/battle.service';
import { GatewayService } from '../gateway/gateway.service';

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
    private readonly gatewayService: GatewayService,
  ) {}

  /**
   * Get all available maps
   */
  async getMaps(): Promise<any[]> {
    const data = this.dataService.getMonsters();
    if (!data?.maps || !Array.isArray(data.maps)) return [];

    // The canonical map catalog lives in monsters.json.maps.
    // Return every configured map so the UI can show locked and unlocked maps.
    return data.maps;
  }

  /**
   * Enter a map and start battles
   */
  async enterMap(characterId: string, mapId: string): Promise<void> {
    const character = await this.characterRepo.findOne({
      where: { id: characterId },
      relations: ['user'],
    });
    if (!character) throw new NotFoundException('Character not found');

    // Check email verification gate (§15.1)
    const user = await this.userRepo.findOne({ where: { id: character.userId } });
    if (user?.emailVerified !== true) {
      throw new BadRequestException('EMAIL_NOT_VERIFIED');
    }

    const map = this.dataService.getMapById(mapId);
    if (!map) throw new BadRequestException('Map not found');

    const foodBuff = character.activeFoodBuff;
    if (!foodBuff?.expiresAt || new Date(foodBuff.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('Town Guard: Your hungry! Eat something or go cleanse your sins for a change.');
    }

    // Validate level requirement
    if (character.level < (map.unlockLevel || 1)) {
      throw new BadRequestException(
        `This map requires level ${map.unlockLevel}. You are level ${character.level}`,
      );
    }

    // Update character status
    character.currentMapId = mapId;
    character.status = 'grinding';
    character.returnToTownAfterBattle = false;
    character.lastSeenAt = new Date();
    await this.characterRepo.save(character);

    // Queue initial battles
    await this.battleService.queueBattles(characterId, 5);

    this.logger.debug(`Character ${characterId} entered map ${mapId}`);
  }

  /**
   * Leave current map
   */
  async leaveMap(characterId: string): Promise<{ deferred: boolean; battleId?: string; character: Pick<Character, 'id' | 'status' | 'currentMapId' | 'lastSeenAt'> }> {
    const character = await this.characterRepo.findOne({
      where: { id: characterId },
    });
    if (!character) throw new NotFoundException('Character not found');
    const mapId = character.currentMapId;
    const activeBattle = (await this.battleService.getBattleQueue(characterId, 100))
      .find((entry) => Date.parse(entry.startAt.toString()) <= Date.now() &&
        Date.now() < Date.parse(entry.endAt.toString()));

    // If a battle is already running, keep that battle authoritative but mark the
    // character as Town immediately and discard only future queued battles. This
    // prevents the queue from starting another encounter before the requested Town
    // return is finalized.
    if (activeBattle) {
      // Register the return request first. The active battle remains authoritative
      // and must resolve before Town is entered.
      character.returnToTownAfterBattle = true;
      await this.characterRepo.save(character);

      if (mapId) {
        await this.gatewayService.removePlayerFromMap(characterId, mapId);
        await this.gatewayService.publishMapPresence(mapId);
      }

      // Cancelling future entries is an optimization/safety cleanup. The persistent
      // flag is the authoritative guard, so a cleanup failure must never turn a
      // valid Town request into a 500 response. The resolving battle will discard
      // any entries that remain after it moves the character to Town.
      try {
        await this.battleService.cancelPendingBattlesAfter(characterId, activeBattle.id);
      } catch (error) {
        this.logger.warn(
          `Could not cancel future battles for Town return ${characterId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return {
        deferred: true,
        battleId: activeBattle.id,
        character: {
          id: character.id,
          status: character.status,
          currentMapId: character.currentMapId,
          lastSeenAt: character.lastSeenAt,
        },
      };
    }

    character.returnToTownAfterBattle = false;
    // null, not undefined: TypeORM skips undefined columns on save
    character.currentMapId = null as any;
    character.status = 'town';
    character.lastSeenAt = new Date();
    await this.characterRepo.save(character);

    if (mapId) {
      await this.gatewayService.removePlayerFromMap(characterId, mapId);
      await this.gatewayService.publishMapPresence(mapId);
    }

    try {
      await this.battleService.cancelPendingBattles(characterId);
    } catch (error) {
      this.logger.warn(
        `Could not cancel queued battles after immediate Town return ${characterId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Coming back must not replay the run that just ended: the map's encounter
    // sequence is rolled over here exactly as it is on a death (SPEC §11.2).
    if (mapId) {
      await this.battleService.resetEncounterSequence(characterId, mapId, 'left map');
    }

    this.logger.debug(`Character ${characterId} left their map`);
    return {
      deferred: false,
      character: {
        id: character.id,
        status: character.status,
        currentMapId: character.currentMapId,
        lastSeenAt: character.lastSeenAt,
      },
    };
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

    const allMaps = await this.getMaps();
    
    // Filter maps that are accessible (within 5 levels)
    return allMaps.filter(map => {
      const minLevel = (map.unlockLevel || 1);
      const maxLevel = Math.min(minLevel + 10, 99);
      return character.level >= minLevel && character.level <= maxLevel;
    });
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
