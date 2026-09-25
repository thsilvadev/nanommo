import { Repository } from 'typeorm';
import { MapKillCounter, Character } from '../../database/entities';
import { DataService } from '../data/data.service';
import { BattleService } from '../battle/battle.service';
export declare class MapService {
    private readonly mapKillCounterRepo;
    private readonly characterRepo;
    private readonly dataService;
    private readonly battleService;
    private readonly logger;
    constructor(mapKillCounterRepo: Repository<MapKillCounter>, characterRepo: Repository<Character>, dataService: DataService, battleService: BattleService);
    /**
     * Get all available maps
     */
    getMaps(): Promise<any[]>;
    /**
     * Enter a map and start battles
     */
    enterMap(characterId: string, mapId: string): Promise<void>;
    /**
     * Leave current map
     */
    leaveMap(characterId: string): Promise<void>;
    /**
     * Get kill counter for a character on a map
     */
    getKillCounter(characterId: string, mapId: string): Promise<MapKillCounter | null>;
    /**
     * Get recommended maps for a character's level
     */
    getRecommendedMaps(characterId: string): Promise<any[]>;
    incrementKillCounter(characterId: string, monsterId: string): Promise<number>;
    /**
     * Get map details with encounter rates
     */
    getMapDetails(mapId: string): Promise<any>;
    /**
     * Validate character level for map
     */
    validateMapAccess(characterId: string, mapId: string): Promise<{
        allowed: boolean;
        reason?: string;
    }>;
}
//# sourceMappingURL=map.service.d.ts.map