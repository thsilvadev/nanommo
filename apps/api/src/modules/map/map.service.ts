import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MapKillCounter, Character, User } from '../../database/entities';
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

  /** Enter any revealed map; Town is peaceful and grind access is never level-gated. */
  async enterMap(characterId: string, mapId: string): Promise<any> {
    const character = await this.characterRepo.findOne({where:{id:characterId},relations:['user']});
    if(!character) throw new NotFoundException('Character not found');
    const map=this.dataService.getMapById(mapId);
    if(!map||map.isClickable===false) throw new BadRequestException('Map not found');
    if(map.type==='grind') {
      const user=await this.userRepo.findOne({where:{id:character.userId}});
      if(user?.emailVerified!==true) throw new BadRequestException('EMAIL_NOT_VERIFIED');
    }
    const storedDiscovered=Array.isArray(character.discoveredMapIds)?character.discoveredMapIds:[TOWN_MAP_ID];
    // Repair the known initial Town bootstrap if its only non-Town discovery is the unrelated Green Grounds 4.
    const persistedDiscovered=character.currentMapId===TOWN_MAP_ID && storedDiscovered.every(id=>id===TOWN_MAP_ID||id==='map_green_grounds_4')
      ? storedDiscovered.filter(id=>id!=='map_green_grounds_4') : storedDiscovered;
    // Current location is authoritative even for characters bootstrapped by the legacy map migration.
    const discovered=Array.from(new Set([...persistedDiscovered, character.currentMapId || TOWN_MAP_ID]));
    const discoveredMaps=discovered.map(id=>this.dataService.getMapById(id)).filter(Boolean);
    const revealed=discoveredMaps.some((known:any)=>Math.abs(Number(known.coordinates.x)-Number(map.coordinates.x))+Math.abs(Number(known.coordinates.y)-Number(map.coordinates.y))<=1);
    if(!revealed) throw new BadRequestException('Map has not been revealed');
    const previousMapId=character.currentMapId;
    const queue=await this.battleService.getBattleQueue(characterId,100);
    const now=Date.now();
    const active=queue.find(entry=>Date.parse(String(entry.startAt))<=now&&now<Date.parse(String(entry.endAt)));
    if(map.type==='town') {
      if(active) {
        character.pendingMapTransition={destinationMapId:mapId,reason:'town_request'} as any;
        character.status='town';
        await this.characterRepo.save(character);
        if(previousMapId) await this.mapPresenceService.syncCharacter(characterId,previousMapId);
        try { await this.battleService.cancelPendingBattlesAfter(characterId,active.id); } catch(error) { this.logger.warn(`Could not trim future queue after Town request: ${error instanceof Error?error.message:String(error)}`); }
        return {deferred:true,battleId:active.id,character:{id:character.id,status:character.status,currentMapId:character.currentMapId,pendingMapTransition:character.pendingMapTransition,discoveredMapIds:character.discoveredMapIds}};
      }
      character.currentMapId=mapId; character.status='town'; character.pendingMapTransition=null; character.lastSeenAt=new Date();
      character.discoveredMapIds=Array.from(new Set([...discovered,mapId])); await this.characterRepo.save(character);
      if(previousMapId) await this.mapPresenceService.syncCharacter(characterId,previousMapId);
      try { await this.battleService.cancelPendingBattles(characterId); } catch(error) { this.logger.warn(`Could not cancel queue after Town entry: ${error instanceof Error?error.message:String(error)}`); }
      if(previousMapId&&previousMapId!==mapId) await this.battleService.resetEncounterSequence(characterId,previousMapId,'left map');
      return {deferred:false,character:{id:character.id,status:character.status,currentMapId:character.currentMapId,discoveredMapIds:character.discoveredMapIds}};
    }
    if(map.type!=='grind') throw new BadRequestException('Invalid map type');
    const foodBuff=character.activeFoodBuff;
    if(!foodBuff?.expiresAt||new Date(foodBuff.expiresAt).getTime()<=Date.now()) throw new BadRequestException('Town Guard: Your hungry! Eat something or go cleanse your sins for a change.');
    if(active) {
      // The active battle snapshot/job is immutable. Persist only the future destination;
      // the resolver commits it after the active battle ends.
      character.pendingMapTransition={destinationMapId:mapId,reason:'town_request'} as any;
      await this.characterRepo.save(character);
      await this.battleService.cancelPendingBattlesAfter(characterId,active.id);
      return {deferred:true,battleId:active.id,character:{id:character.id,status:character.status,currentMapId:character.currentMapId,pendingMapTransition:character.pendingMapTransition,discoveredMapIds:character.discoveredMapIds}};
    }
    character.discoveredMapIds=Array.from(new Set([...discovered,mapId]));
    character.currentMapId=mapId; character.status='grinding'; character.pendingMapTransition=null; character.lastSeenAt=new Date();
    await this.characterRepo.save(character);
    if(previousMapId) await this.mapPresenceService.syncCharacter(characterId,previousMapId);
    await this.battleService.cancelPendingBattles(characterId);
    await this.battleService.queueBattles(characterId,5);
    this.logger.debug(`Character ${characterId} entered map ${mapId}`);
    return {deferred:false,character:{id:character.id,status:character.status,currentMapId:character.currentMapId,discoveredMapIds:character.discoveredMapIds}};
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
