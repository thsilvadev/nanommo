import { MapService } from './map.service';
import { CharacterService } from '../character/character.service';
export declare class MapController {
    private readonly mapService;
    private readonly characterService;
    constructor(mapService: MapService, characterService: CharacterService);
    /**
     * Get all available maps
     */
    getMaps(): Promise<any[]>;
    /**
     * Get maps recommended for character's level
     */
    getRecommendedMaps(req: any): Promise<any[]>;
    /**
     * Enter a map
     */
    enterMap(req: any, mapId: string): Promise<{
        success: boolean;
        currentMap: string;
    }>;
    /**
     * Leave current map
     */
    leaveMap(req: any): Promise<{
        success: boolean;
    }>;
    /**
     * Get kill counter for map
     */
    getKillCounter(req: any, mapId: string): Promise<import("../../database/entities").MapKillCounter | null>;
}
//# sourceMappingURL=map.controller.d.ts.map