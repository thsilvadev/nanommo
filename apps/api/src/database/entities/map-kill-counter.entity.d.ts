import { Character } from './character.entity';
export declare class MapKillCounter {
    id: string;
    characterId: string;
    character?: Character;
    mapId: string;
    epoch: number;
    mapKillCount: number;
    perMonsterKillCount: Record<string, number>;
}
//# sourceMappingURL=map-kill-counter.entity.d.ts.map