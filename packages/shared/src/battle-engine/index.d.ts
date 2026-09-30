/**
 * Mulberry32 - A fast pseudo-random number generator
 * Seed-based for deterministic battle outcomes
 */
export declare class Mulberry32 {
    private seed;
    constructor(seed: string | number);
    private hashString;
    /**
     * Returns next random number between 0 and 1
     */
    next(): number;
    /**
     * Returns random integer between min (inclusive) and max (exclusive)
     */
    nextInt(min: number, max: number): number;
    /**
     * Returns random number between 0 and 100 (useful for percentages)
     */
    nextPercent(): number;
    /**
     * Weighted pick from array
     */
    weightedPick<T extends {
        weight?: number;
    }>(items: T[]): T;
    /**
     * Create a new PRNG advanced by N positions for subindexing
     */
    fork(index: number): Mulberry32;
}
/**
 * Gambit Evaluator - Evaluates gambit conditions and actions
 * Pure function for deterministic automation
 */
export declare class GambitEvaluator {
    /**
     * Helper: Check if a value is within an HP band percentage
     */
    static isInHpBand(currentHp: number, maxHp: number, band: string): boolean;
    /**
     * Evaluate a single condition
     */
    static evaluateCondition(condition: any, characterSnapshot: any, monsterSnapshot: any, inventory?: Record<string, number>): boolean;
    /**
     * Evaluate the single condition configured on a gambit line.
     */
    static evaluateConditions(conditions: any[], characterSnapshot: any, monsterSnapshot: any, inventory?: Record<string, number>): boolean;
    /**
     * Check if an action is legal to execute
     * (Simplified: in full impl, check skill unlocked, cooldown, SP, item stock)
     */
    static isActionLegal(action: any, characterSnapshot: any, inventory?: Record<string, number>): boolean;
    /**
     * Evaluate gambit page for a specific gauge type (attack/cast) and return first valid action
     */
    static evaluateGambitPage(gambitPage: any, gaugeType: 'attack' | 'cast', characterSnapshot: any, monsterSnapshot: any, inventory?: Record<string, number>): any;
}
/**
 * Battle Engine - Pure deterministic combat simulator
 */
export declare class BattleEngine {
    static readonly BASE_CAST_TICKS = 8;
    static readonly BASIC_ATTACK_CAST_TICKS = 2;
    static readonly POTION_COOLDOWN = 5;
    static readonly DEF_SOFT_CAP = 300;
    static readonly CRIT_MULTIPLIER = 1.5;
    static readonly MIN_ATTACK_GAUGE = 2;
    static readonly MIN_CAST_GAUGE = 3;
    static readonly DEFEND_DAMAGE_REDUCTION = 0.3;
    /**
     * Calculate derived stats from base attributes and equipment
     */
    static calculateDerivedStats(level: number, attributes: Record<string, number>, equipment: any): {
        maxHp: number;
        maxSp: number;
        atk: any;
        matk: any;
        def: any;
        mdefPercent: number;
        accuracy: number;
        evasion: number;
        critChance: number;
        hpRegenPerTick: number;
        spRegenPerTick: number;
    };
    /**
     * Calculate physical damage after mitigation
     */
    static calculatePhysicalDamage(rawDamage: number, def: number): number;
    /**
     * Calculate magic damage after mitigation
     */
    static calculateMagicDamage(rawDamage: number, mdefPercent: number): number;
    /**
     * Calculate hit chance given accuracy and evasion
     */
    static calculateHitChance(accuracy: number, evasion: number): number;
    /**
     * Simulate a single battle (pure function, deterministic)
     */
    static simulateBattle(characterSnapshot: any, monsterDefinition: any, gambitPage: any, seed: string): any;
}
export default BattleEngine;
//# sourceMappingURL=index.d.ts.map