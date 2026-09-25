import { User } from './user.entity';
export declare class Character {
    id: string;
    userId: string;
    user?: User;
    name: string;
    level: number;
    xp: number;
    unspentAttributePoints: number;
    str: number;
    agi: number;
    dex: number;
    vit: number;
    int: number;
    sor: number;
    gold: number;
    hpCurrent: number;
    spCurrent: number;
    currentMapId?: string;
    status: string;
    activeGambitPageId?: string;
    lastDeathLog?: any;
    activeFoodBuff?: any;
    activeTempBuffs: any[];
    statusEffects: any[];
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=character.entity.d.ts.map