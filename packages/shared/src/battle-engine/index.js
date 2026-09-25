"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleEngine = exports.GambitEvaluator = exports.Mulberry32 = void 0;
/**
 * Mulberry32 - A fast pseudo-random number generator
 * Seed-based for deterministic battle outcomes
 */
class Mulberry32 {
    seed;
    constructor(seed) {
        if (typeof seed === 'string') {
            this.seed = this.hashString(seed);
        }
        else {
            this.seed = seed;
        }
    }
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }
    /**
     * Returns next random number between 0 and 1
     */
    next() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    /**
     * Returns random integer between min (inclusive) and max (exclusive)
     */
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min)) + min;
    }
    /**
     * Returns random number between 0 and 100 (useful for percentages)
     */
    nextPercent() {
        return this.next() * 100;
    }
    /**
     * Weighted pick from array
     */
    weightedPick(items) {
        const totalWeight = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
        let pick = this.next() * totalWeight;
        for (const item of items) {
            pick -= item.weight ?? 1;
            if (pick <= 0)
                return item;
        }
        return items[items.length - 1];
    }
    /**
     * Create a new PRNG advanced by N positions for subindexing
     */
    fork(index) {
        const forked = new Mulberry32(this.seed);
        for (let i = 0; i < index; i++) {
            forked.next();
        }
        return forked;
    }
}
exports.Mulberry32 = Mulberry32;
/**
 * Gambit Evaluator - Evaluates gambit conditions and actions
 * Pure function for deterministic automation
 */
class GambitEvaluator {
    /**
     * Helper: Check if a value is within an HP band percentage
     */
    static isInHpBand(currentHp, maxHp, band) {
        const percent = (currentHp / maxHp) * 100;
        const bands = {
            FULL: [100, 100],
            HIGH: [70, 99],
            MEDIUM: [30, 69],
            LOW: [10, 29],
            CRITICAL: [1, 9],
        };
        const [min, max] = bands[band] || [0, 0];
        return percent >= min && percent <= max;
    }
    /**
     * Evaluate a single condition
     */
    static evaluateCondition(condition, characterSnapshot, monsterSnapshot, inventory = {}) {
        const { id, params = {} } = condition;
        switch (id) {
            case 'always':
                return true;
            case 'self_hp_band':
                return this.isInHpBand(characterSnapshot.hp, characterSnapshot.stats.maxHp, params.band);
            case 'self_sp_band':
                return this.isInHpBand(characterSnapshot.sp, characterSnapshot.stats.maxSp, params.band);
            case 'foe_hp_band':
                return this.isInHpBand(monsterSnapshot.hp, monsterSnapshot.maxHp || 100, // fallback
                params.band);
            case 'self_has_status':
                return (characterSnapshot.statusEffects || []).some((status) => status.type === params.status);
            case 'self_missing_status':
                return !(characterSnapshot.statusEffects || []).some((status) => status.type === params.status);
            case 'foe_has_status':
                return (monsterSnapshot.statusEffects || []).some((status) => status.type === params.status);
            case 'self_hungry':
                return !characterSnapshot.foodBuff || characterSnapshot.foodBuff.expiresAt < new Date();
            case 'foe_element_is':
                return monsterSnapshot.element === params.element;
            case 'skill_ready':
                // Skill is ready if not on cooldown
                const skillCooldown = characterSnapshot.cooldowns?.[params.skillId] ?? 0;
                return skillCooldown <= 0;
            case 'item_in_stock':
                const quantity = inventory[params.itemId] ?? 0;
                const comparator = params.comparator ?? 'ANY';
                if (comparator === 'ANY') {
                    return quantity > 0;
                }
                if (comparator === 'NONE') {
                    return quantity === 0;
                }
                return false;
            default:
                return false;
        }
    }
    /**
     * Evaluate a gambit line's conditions (handling AND/OR combinator)
     */
    static evaluateConditions(conditions, combinator, characterSnapshot, monsterSnapshot, inventory = {}) {
        if (!conditions || conditions.length === 0) {
            return true; // No conditions = always true
        }
        if (conditions.length === 1) {
            return this.evaluateCondition(conditions[0], characterSnapshot, monsterSnapshot, inventory);
        }
        // Two conditions with combinator
        const cond1 = this.evaluateCondition(conditions[0], characterSnapshot, monsterSnapshot, inventory);
        const cond2 = this.evaluateCondition(conditions[1], characterSnapshot, monsterSnapshot, inventory);
        if (combinator === 'AND') {
            return cond1 && cond2;
        }
        if (combinator === 'OR') {
            return cond1 || cond2;
        }
        // Default: AND
        return cond1 && cond2;
    }
    /**
     * Check if an action is legal to execute
     * (Simplified: in full impl, check skill unlocked, cooldown, SP, item stock)
     */
    static isActionLegal(action, characterSnapshot, inventory = {}) {
        const { id, params = {} } = action;
        switch (id) {
            case 'attack':
                // Always legal if character is alive
                return characterSnapshot.hp > 0;
            case 'use_skill':
                // TODO: Check if skill is unlocked for equipped weapon
                // TODO: Check if SP is sufficient for skill
                // TODO: Check if skill is off cooldown
                const skillCooldown = characterSnapshot.cooldowns?.[params.skillId] ?? 0;
                return skillCooldown <= 0 && characterSnapshot.sp > 0;
            case 'use_item':
                // Check if item is in inventory with quantity > 0
                const itemQty = inventory[params.itemId] ?? 0;
                const itemCooldown = characterSnapshot.cooldowns?.[`item_${params.itemId}`] ?? 0;
                return itemQty > 0 && itemCooldown <= 0;
            case 'defend':
                // Always legal
                return true;
            case 'wait':
                // Always legal
                return true;
            default:
                return false;
        }
    }
    /**
     * Evaluate gambit page for a specific gauge type (attack/cast) and return first valid action
     */
    static evaluateGambitPage(gambitPage, gaugeType, characterSnapshot, monsterSnapshot, inventory = {}) {
        if (!gambitPage || !gambitPage.lines) {
            return null;
        }
        // Map gauge types to action types
        const validActionTypes = {
            attack: ['attack'],
            cast: ['use_skill', 'use_item', 'defend', 'wait'],
        };
        const allowedActions = validActionTypes[gaugeType] || [];
        // Walk lines top to bottom
        for (const line of gambitPage.lines) {
            // Filter by action type
            const action = line.action;
            if (!allowedActions.includes(action.id)) {
                continue;
            }
            // Evaluate conditions
            const conditionsMet = this.evaluateConditions(line.conditions, line.combinator, characterSnapshot, monsterSnapshot, inventory);
            if (!conditionsMet) {
                continue;
            }
            // Check if action is legal
            const isLegal = this.isActionLegal(action, characterSnapshot, inventory);
            if (!isLegal) {
                // Condition is true but action is illegal - skip to next line
                continue;
            }
            // First line that is condition-true AND legal
            return action;
        }
        // No valid action found
        return null;
    }
}
exports.GambitEvaluator = GambitEvaluator;
/**
 * Battle Engine - Pure deterministic combat simulator
 */
class BattleEngine {
    static BASE_CAST_TICKS = 8;
    static BASIC_ATTACK_CAST_TICKS = 2;
    static POTION_COOLDOWN = 5;
    static DEF_SOFT_CAP = 300;
    static CRIT_MULTIPLIER = 1.5;
    static MIN_ATTACK_GAUGE = 2;
    static MIN_CAST_GAUGE = 3;
    static DEFEND_DAMAGE_REDUCTION = 0.3;
    /**
     * Calculate derived stats from base attributes and equipment
     */
    static calculateDerivedStats(level, attributes, equipment) {
        const str = attributes['str'] ?? 5;
        const agi = attributes['agi'] ?? 5;
        const dex = attributes['dex'] ?? 5;
        const vit = attributes['vit'] ?? 5;
        const int = attributes['int'] ?? 5;
        const sor = attributes['sor'] ?? 5;
        const maxHp = 80 + vit * 12 + level * 18;
        const maxSp = 40 + int * 10 + level * 8;
        // Include weapon fixed attack values from equipment
        const atk = str * 2.2 + dex * 0.5 + (equipment?.weaponFixedAtk ?? 0);
        const matk = int * 2.5 + dex * 0.3 + (equipment?.weaponFixedMatk ?? 0);
        const def = equipment?.def ?? 0;
        const mdefPercent = Math.min(equipment?.mdefPercent ?? 0, 100);
        const accuracy = 75 + dex * 1.0 + level * 1.0;
        const evasion = agi * 0.8;
        const critChance = Math.max(1, Math.min(1 + sor * 0.3, 50));
        const hpRegenPerTick = 1 + Math.floor(vit * 0.5) + Math.floor(maxHp * 0.005);
        const spRegenPerTick = 1 + Math.floor(int * 0.5) + Math.floor(maxSp * 0.01);
        return {
            maxHp,
            maxSp,
            atk,
            matk,
            def,
            mdefPercent,
            accuracy,
            evasion,
            critChance,
            hpRegenPerTick,
            spRegenPerTick,
        };
    }
    /**
     * Calculate physical damage after mitigation
     */
    static calculatePhysicalDamage(rawDamage, def) {
        return rawDamage * (1 - def / (def + BattleEngine.DEF_SOFT_CAP));
    }
    /**
     * Calculate magic damage after mitigation
     */
    static calculateMagicDamage(rawDamage, mdefPercent) {
        return rawDamage * (1 - mdefPercent / 100);
    }
    /**
     * Calculate hit chance given accuracy and evasion
     */
    static calculateHitChance(accuracy, evasion) {
        return Math.max(5, Math.min(95, 75 + (accuracy - evasion) * 0.5));
    }
    /**
     * Simulate a single battle (pure function, deterministic)
     */
    static simulateBattle(characterSnapshot, monsterDefinition, gambitPage, seed) {
        const rng = new Mulberry32(seed);
        const events = [];
        let characterHp = characterSnapshot.hpCurrent || characterSnapshot.hp;
        let monsterHp = monsterDefinition.hp;
        let characterSp = characterSnapshot.spCurrent || characterSnapshot.sp;
        let tick = 0;
        let characterAttackGauge = 0;
        let characterCastGauge = 0;
        let monsterAttackGauge = 0;
        // Mock inventory - in real impl, would be passed from CharacterService
        const inventory = {};
        // Cooldowns tracking (in ticks)
        const characterCooldowns = {};
        const maxTicks = 60; // Safety limit per spec
        while (tick < maxTicks && characterHp > 0 && monsterHp > 0) {
            // ===== CHARACTER ACTIONS =====
            // Character attack gauge fires
            const weaponBaseAttackTicks = 6; // TODO: from equipped weapon
            const attackGaugeThreshold = Math.max(BattleEngine.MIN_ATTACK_GAUGE, weaponBaseAttackTicks - Math.floor(characterSnapshot.agi * 0.04));
            characterAttackGauge++;
            if (characterAttackGauge >= attackGaugeThreshold) {
                // Evaluate gambit for attack gauge
                const action = GambitEvaluator.evaluateGambitPage(gambitPage, 'attack', {
                    ...characterSnapshot,
                    hp: characterHp,
                    sp: characterSp,
                    cooldowns: characterCooldowns,
                }, {
                    ...monsterDefinition,
                    hp: monsterHp,
                }, inventory);
                // Execute action
                if (action && action.id === 'attack') {
                    const hitChance = BattleEngine.calculateHitChance(characterSnapshot.stats.accuracy, monsterDefinition.evasion);
                    if (rng.nextPercent() < hitChance) {
                        const isCrit = rng.nextPercent() < characterSnapshot.stats.critChance;
                        const baseDamage = characterSnapshot.stats.atk +
                            (isCrit ? characterSnapshot.stats.atk * (BattleEngine.CRIT_MULTIPLIER - 1) : 0);
                        const finalDamage = Math.floor(BattleEngine.calculatePhysicalDamage(baseDamage, monsterDefinition.def));
                        monsterHp = Math.max(0, monsterHp - finalDamage);
                        events.push({
                            tick,
                            actor: 'character',
                            action: 'attack',
                            target: 'monster',
                            damage: finalDamage,
                            damageType: 'melee',
                            crit: isCrit,
                            hpRemaining: { character: characterHp, monster: monsterHp },
                        });
                    }
                    else {
                        events.push({
                            tick,
                            actor: 'character',
                            action: 'attack',
                            target: 'monster',
                            damage: 0,
                            damageType: 'melee',
                            crit: false,
                            hit: false,
                            hpRemaining: { character: characterHp, monster: monsterHp },
                        });
                    }
                }
                // Reset gauge
                characterAttackGauge = 0;
            }
            // Character cast gauge fires (for skills/items)
            const castGaugeThreshold = Math.max(BattleEngine.MIN_CAST_GAUGE, BattleEngine.BASE_CAST_TICKS - Math.floor(characterSnapshot.dex * 0.05));
            characterCastGauge++;
            if (characterCastGauge >= castGaugeThreshold) {
                // Evaluate gambit for cast gauge
                const castAction = GambitEvaluator.evaluateGambitPage(gambitPage, 'cast', {
                    ...characterSnapshot,
                    hp: characterHp,
                    sp: characterSp,
                    cooldowns: characterCooldowns,
                }, {
                    ...monsterDefinition,
                    hp: monsterHp,
                }, inventory);
                // Execute cast action
                if (castAction) {
                    if (castAction.id === 'use_item' && inventory[castAction.params.itemId]) {
                        // Use item
                        inventory[castAction.params.itemId]--;
                        characterCooldowns[`item_${castAction.params.itemId}`] = BattleEngine.POTION_COOLDOWN;
                        // Placeholder: assume HP potion
                        characterHp = Math.min(characterSnapshot.stats.maxHp, characterHp + 100);
                        events.push({
                            tick,
                            actor: 'character',
                            action: 'use_item',
                            itemId: castAction.params.itemId,
                            target: 'character',
                            healAmount: 100,
                            hpRemaining: { character: characterHp, monster: monsterHp },
                        });
                    }
                    else if (castAction.id === 'defend') {
                        // Defend reduces next incoming hit by 30%
                        events.push({
                            tick,
                            actor: 'character',
                            action: 'defend',
                            target: 'character',
                            hpRemaining: { character: characterHp, monster: monsterHp },
                        });
                    }
                    else if (castAction.id === 'wait') {
                        // Do nothing - just idle
                        events.push({
                            tick,
                            actor: 'character',
                            action: 'wait',
                            target: 'self',
                            hpRemaining: { character: characterHp, monster: monsterHp },
                        });
                    }
                }
                characterCastGauge = 0;
            }
            // ===== MONSTER ACTIONS =====
            monsterAttackGauge++;
            if (monsterAttackGauge >= monsterDefinition.atkSpeedTicks) {
                const monsterHitChance = BattleEngine.calculateHitChance(monsterDefinition.accuracy, characterSnapshot.stats.evasion);
                if (rng.nextPercent() < monsterHitChance) {
                    const isCrit = rng.nextPercent() < monsterDefinition.critChance;
                    const baseDamage = monsterDefinition.atk +
                        (isCrit ? monsterDefinition.atk * (BattleEngine.CRIT_MULTIPLIER - 1) : 0);
                    const finalDamage = Math.floor(BattleEngine.calculatePhysicalDamage(baseDamage, characterSnapshot.stats.def));
                    characterHp = Math.max(0, characterHp - finalDamage);
                    events.push({
                        tick,
                        actor: 'monster',
                        action: 'attack',
                        target: 'character',
                        damage: finalDamage,
                        damageType: 'melee',
                        crit: isCrit,
                        hpRemaining: { character: characterHp, monster: monsterHp },
                    });
                }
                else {
                    events.push({
                        tick,
                        actor: 'monster',
                        action: 'attack',
                        target: 'character',
                        damage: 0,
                        damageType: 'melee',
                        crit: false,
                        hit: false,
                        hpRemaining: { character: characterHp, monster: monsterHp },
                    });
                }
                monsterAttackGauge = 0;
            }
            // ===== TICK HOUSEKEEPING =====
            // Decrement cooldowns
            for (const key in characterCooldowns) {
                characterCooldowns[key]--;
                if (characterCooldowns[key] < 0) {
                    delete characterCooldowns[key];
                }
            }
            // Increment tick
            tick++;
        }
        const xpGain = (monsterDefinition.xpReward || 10) * (characterSnapshot.level || 1);
        const goldMin = monsterDefinition.goldReward?.min || 5;
        const goldMax = monsterDefinition.goldReward?.max || 15;
        const goldGain = Math.floor(goldMin + rng.next() * (goldMax - goldMin));
        return {
            outcome: characterHp > 0 ? 'win' : 'loss',
            durationTicks: tick,
            log: {
                header: {
                    mapId: 'map_green_grounds',
                    monsterId: monsterDefinition.id,
                    seedUsed: seed,
                    characterSnapshot,
                    monsterSnapshot: monsterDefinition,
                },
                events,
                outcome: characterHp > 0 ? 'win' : 'loss',
                durationTicks: tick,
            },
            xpGain,
            goldGain,
            drops: [],
            hpAfter: characterHp,
            spAfter: characterSp,
        };
    }
}
exports.BattleEngine = BattleEngine;
exports.default = BattleEngine;
