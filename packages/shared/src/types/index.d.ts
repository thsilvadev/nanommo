import { Attribute, WeaponType, DamageType } from '../enums';
export * from '../enums';
export interface DerivedStats {
    maxHp: number;
    maxSp: number;
    atk: number;
    matk: number;
    def: number;
    mdefPercent: number;
    accuracy: number;
    evasion: number;
    critChance: number;
    hpRegenPerTick: number;
    spRegenPerTick: number;
}
export interface CharacterSnapshot {
    level: number;
    hp: number;
    sp: number;
    attributes: Record<Attribute, number>;
    stats: DerivedStats;
    equipment: EquipmentSnapshot;
    gambitPage: GambitPage | null;
    foodBuff: FoodBuff | null;
    statusEffects: StatusEffect[];
    cooldowns: Record<string, number>;
}
export interface EquipmentSnapshot {
    mainHand: EquippedItemSnapshot | null;
    offHand: EquippedItemSnapshot | null;
    [key: string]: EquippedItemSnapshot | null;
}
export interface EquippedItemSnapshot {
    id: string;
    weaponType?: WeaponType;
    damageType?: DamageType;
    statBonus?: Record<Attribute, number>;
    def?: number;
    mdefPercent?: number;
    instanceData?: {
        rolledAttribute: Attribute;
        rolledValue: number;
    };
}
export interface MonsterSnapshot {
    level: number;
    hp: number;
    atk: number;
    matk: number;
    def: number;
    mdefPercent: number;
    accuracy: number;
    evasion: number;
    critChance: number;
    atkSpeedTicks: number;
    damageType: DamageType;
}
export interface GambitPage {
    id: string;
    characterId: string;
    slotIndex: number;
    title?: string;
    lines: GambitLine[];
}
export interface GambitLine {
    priority: number;
    conditions: GambitCondition[];
    combinator?: 'AND' | 'OR';
    action: GambitAction;
}
export interface GambitCondition {
    id: string;
    params?: Record<string, string | number>;
}
export interface GambitAction {
    id: string;
    params?: Record<string, string | number>;
}
export interface BattleEvent {
    tick: number;
    actor: 'character' | 'monster';
    action: string;
    target: 'character' | 'monster';
    damage?: number;
    damageType?: DamageType;
    crit?: boolean;
    healAmount?: number;
    hpRemaining: {
        character: number;
        monster: number;
    };
    spRemaining?: {
        character: number;
        monster: number;
    };
}
export interface BattleLog {
    header: {
        mapId: string;
        monsterId: string;
        seedUsed: string;
        characterSnapshot: CharacterSnapshot;
        monsterSnapshot: MonsterSnapshot;
    };
    events: BattleEvent[];
    outcome: 'win' | 'loss';
    durationTicks: number;
}
export interface BattleResult {
    outcome: 'win' | 'loss';
    durationTicks: number;
    log: BattleLog;
    xpGain: number;
    goldGain: number;
    drops: {
        itemId: string;
        quantity: number;
    }[];
    hpAfter: number;
    spAfter: number;
}
export interface FoodBuff {
    itemId: string;
    hpRegenPerTick: number;
    spRegenPerTick: number;
    expiresAt: Date;
}
export interface StatusEffect {
    type: string;
    appliedAtTick: number;
    expiresAtTick: number;
    sourceSkillId?: string;
}
export interface WeaponProficiency {
    characterId: string;
    weaponType: WeaponType;
    level: number;
    xp: number;
}
export interface XpCurveEntry {
    level: number;
    xpToNext: number;
    cumulativeXp: number;
    estHoursAtThisLevel: number;
    estDaysAtThisLevel: number;
}
//# sourceMappingURL=index.d.ts.map