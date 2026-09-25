import { Character } from './character.entity';
export declare class BattleQueueEntry {
    id: string;
    characterId: string;
    character?: Character;
    sequenceIndex: number;
    mapId: string;
    monsterId: string;
    startAt: Date;
    endAt: Date;
    outcome: 'win' | 'loss';
    log: any;
    xpGain: number;
    goldGain: number;
    drops: any[];
    hpAfter: number;
    spAfter: number;
    resolved: boolean;
    seedUsed: string;
}
//# sourceMappingURL=battle-queue-entry.entity.d.ts.map