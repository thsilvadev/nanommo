import { Mulberry32 } from './prng';
import type { StatusEffectDefinition } from '../types';

export {
  Mulberry32,
  mulberry32Seed,
  rngForIndex,
} from './prng';
export * from './rewards';
export * from './mastery-rewards';

/** Effective food regeneration value: Diet level adds +1 per level. */
export function effectiveFoodStatValue(catalogValue: number, dietLevel: number): number {
  const value = Number(catalogValue ?? 0);
  const level = Math.max(0, Math.min(3, Number(dietLevel ?? 0)));
  return value + level;
}

/**
 * A combatant snapshot as seen by the gambit evaluator.
 * Kept structural (any) on purpose: the API builds it, the engine only reads it.
 */
export interface CombatantSnapshot {
  level: number;
  hp: number;
  sp: number;
  maxHp: number;
  maxSp: number;
  atk: number;
  matk: number;
  def: number;
  mdefPercent: number;
  accuracy: number;
  evasion: number;
  critChance: number;
  hpRegenPerTenTicks: number;
  spRegenPerTenTicks: number;
  /** Current tick index, needed by tick-indexed conditions (e.g. every_n_ticks) */
  tick?: number;
  /** Raw attributes retained for attribute-driven secondary mechanics. */
  agi: number;
  dex: number;
  luk?: number;
  equippedWeaponTypes?: string[];
  /** Derived Attack Speed rating (0..800 effective range); applies only to basic attacks. */
  attackSpeed?: number;
  /** Skills currently usable (unlocked + weapon equipped) - SPEC §9.1 */
  skills?: Record<string, any>;
  /** Frozen slot/category metadata used only for transactional Mastery rewards. */
  masteryEquipment?: Array<{ slot: 'mainHand' | 'offHand'; category: string; twoHanded: boolean }>;
  /** Skill defs, needed for spCost/baseCastTicks/cooldownTicks - SPEC §9 */
  skillDefs?: Record<string, any>;
  statusEffects?: any[];
  /** Remaining ticks on the active food buff. 0/undefined = hungry. */
  foodBuffTicksRemaining?: number;
  foodBuffItemId?: string;
  foodBuffHpRegenPerTenTicks?: number;
  foodBuffSpRegenPerTenTicks?: number;
  /** Every independently digesting food contributes its regen until its own expiry. */
  foodBuffs?: Array<{ itemId: string; hpRegenPerTenTicks: number; spRegenPerTenTicks: number; remainingTicks: number }>;
  /** Remaining digestion ticks per food item; prevents repeat consumption while digesting. */
  foodDigestRemainingTicksByItem?: Record<string, number>;
  /** Persisted Diet level per food; absent means the food has never been consumed. */
  dietLevelByFood?: Record<string, number>;
  /** Ticks left per cooldown key. Keys: `skill:<id>`, `item:potion`, `defend`. */
  cooldowns?: Record<string, number>;
  /**
   * Ticks left while a previously triggered action of that gauge is still
   * resolving (SPEC §7.2 baseCastTicks). Locks are per-gauge: a 2-tick melee
   * swing must not stop the cast gauge from ever firing a potion, otherwise
   * `use_item` gambits are structurally unreachable in a real fight.
   */
  attackLockTicks?: number;
  castLockTicks?: number;
  /** Set by the engine when the combatant braced; cleared on the next hit taken. */
  defending?: boolean;
  element?: string | null;
  characterName?: string;
  /** Distinguishes player-only rules such as Disarm from monster behavior. */
  isPlayerCharacter?: boolean;
  combatStyle?: 'melee' | 'ranged';
  position?: number;
  basicAttackDamageType?: 'melee' | 'ranged' | 'magic';
  basicAttackRange?: number;
  moveSpeedBase?: number;
  moveSpeed?: number;
  movementGauge?: number;
  movementIntent?: boolean;
  movementIntentRange?: number;
  canMove?: boolean;
}

export type GambitGaugeType = 'attack' | 'cast';

/**
 * Gambit Evaluator - Evaluates gambit conditions and actions
 * Pure function for deterministic automation (SPEC §7.3, §8)
 */
export class GambitEvaluator {
  /**
   * HP/SP bands per SPEC §8.3: FULL(100%), HIGH(70-99%), MEDIUM(30-69%),
   * LOW(10-29%), CRITICAL(1-9%). Half-open so a value of exactly 100 is FULL
   * and 69.5 is MEDIUM (not HIGH).
   */
  private static readonly BANDS: Record<string, [number, number]> = {
    FULL: [100, Number.POSITIVE_INFINITY],
    HIGH: [70, 100],
    MEDIUM: [30, 70],
    LOW: [10, 30],
    CRITICAL: [0, 10],
  };

  static isInHpBand(currentHp: number, maxHp: number, band: string): boolean {
    if (!maxHp || maxHp <= 0) return false;
    const bounds = GambitEvaluator.BANDS[band];
    if (!bounds) return false;
    const percent = (currentHp / maxHp) * 100;
    return percent >= bounds[0] && percent < bounds[1];
  }

  /**
   * Gambit conditions exist in two shapes in this codebase:
   *  - SPEC §8.2 nested:      { id: 'self_hp_band', params: { band: 'LOW' } }
   *  - gambit_catalog.json:   { id: 'self_hp_band', band: 'LOW' }
   * Both must work, otherwise every catalog-shaped page silently never matches.
   */
  private static readParams(node: any): Record<string, any> {
    if (!node) return {};
    const { id, params, ...rest } = node;
    return { ...rest, ...(params ?? {}) };
  }

  /**
   * Evaluate a single condition (SPEC §8.3)
   */
  static evaluateCondition(
    condition: any,
    self: CombatantSnapshot,
    foe: CombatantSnapshot,
    inventory: Record<string, number> = {},
  ): boolean {
    // monsters.json writes { type, value }; gambit_catalog.json writes { id, ... }
    const id = condition?.id ?? condition?.type;
    const params = GambitEvaluator.readParams(condition);

    switch (id) {
      case 'always':
        return true;

      // monsters.json raw conditions (SPEC §7.3: monsters use the same engine)
      case 'self_hp_below_percent':
        return self.maxHp > 0 && (self.hp / self.maxHp) * 100 < Number(params.value);
      case 'foe_hp_below_percent':
        return foe.maxHp > 0 && (foe.hp / foe.maxHp) * 100 < Number(params.value);
      case 'every_n_ticks': {
        const n = Number(params.value);
        return n > 0 && (self.tick ?? 0) % n === 0;
      }

      case 'self_hp_band':
        return GambitEvaluator.isInHpBand(self.hp, self.maxHp, params.band);

      case 'self_sp_band':
        return GambitEvaluator.isInHpBand(self.sp, self.maxSp, params.band);

      case 'foe_hp_band':
        return GambitEvaluator.isInHpBand(foe.hp, foe.maxHp, params.band);

      case 'self_has_status':
        return (self.statusEffects ?? []).some(
          (s: any) => (s.type ?? s.id) === params.status,
        );

      case 'self_missing_status':
        return !(self.statusEffects ?? []).some(
          (s: any) => (s.type ?? s.id) === params.status,
        );

      case 'foe_has_status':
        return (foe.statusEffects ?? []).some(
          (s: any) => (s.type ?? s.id) === params.status,
        );

      case 'foe_element_is':
        return (foe.element ?? null) === params.element;

      case 'skill_ready': {
        const cooldown = self.cooldowns?.[`skill:${params.skillId}`] ?? 0;
        return cooldown <= 0;
      }

      case 'item_in_stock': {
        const quantity = inventory[params.itemId] ?? 0;
        const comparator = params.comparator ?? 'ANY';
        if (comparator === 'ANY') return quantity > 0;
        if (comparator === 'NONE') return quantity === 0;
        return false;
      }

      default:
        return false;
    }
  }

  /** Evaluate the single condition configured on a gambit line. */
  static evaluateConditions(
    conditions: any[],
    self: CombatantSnapshot,
    foe: CombatantSnapshot,
    inventory: Record<string, number> = {},
  ): boolean {
    if (!conditions || conditions.length === 0) return true;
    return GambitEvaluator.evaluateCondition(conditions[0], self, foe, inventory);
  }

  /**
   * Is the action currently legal? (SPEC §7.3 step 3)
   * A condition-true but illegal line is SKIPPED, not blocking (§7.3 step 4).
   */
  static isActionLegal(
    action: any,
    self: CombatantSnapshot,
    inventory: Record<string, number> = {},
    itemDefinitions: Record<string, any> = {},
  ): boolean {
    const id = action?.id;
    const params = GambitEvaluator.readParams(action);
    const cooldowns = self.cooldowns ?? {};

    switch (id) {
      case 'attack':
        return self.hp > 0 && self.maxHp > 0
          && !((self.statusEffects ?? []).some((status: any) => ['disarm', 'disarmed'].includes(String(status.type ?? status.id ?? '').toLowerCase())));

      case 'use_skill': {
        const skillId = params.skillId;
        // Silence prevents casting; Gambit skips this line and can fall through to a legal fallback.
        if ((self.statusEffects ?? []).some((status: any) => ['silence', 'silenced'].includes(String(status.type ?? status.id ?? '').toLowerCase()))) return false;
        // unlocked for the equipped weapon (SPEC §9.1)
        if (!skillId || !self.skills?.[skillId]) return false;
        // off cooldown
        if ((cooldowns[`skill:${skillId}`] ?? 0) > 0) return false;
        // enough SP
        const spCost = Number(self.skillDefs?.[skillId]?.spCost ?? 0);
        if (self.sp < spCost) return false;
        return true;
      }

      case 'use_item': {
        const itemId = params.itemId;
        const definition = itemDefinitions[itemId];
        if (definition?.type !== 'consumable') return false;
        if (!itemId) return false;
        if ((inventory[itemId] ?? 0) <= 0) return false;
        if ((self.foodDigestRemainingTicksByItem?.[itemId] ?? 0) > 0) return false;
        // Potions share a single 5-tick cooldown CATEGORY (SPEC §7.2):
        // using any HP/SP potion puts ALL potions on cooldown for 5 ticks.
        if (String(itemId).startsWith('pot_') && (cooldowns['item:potion'] ?? 0) > 0) return false;
        if ((cooldowns[`item:${itemId}`] ?? 0) > 0) return false;
        return true;
      }

      case 'defend':
        return self.hp > 0;

      case 'wait':
        return true;

      default:
        return false;
    }
  }

  /**
   * Actions reachable from each gauge fire (SPEC §7.3 step 1):
   * an Attack-gauge fire can only trigger `attack`; a Cast-gauge fire can
   * trigger `use_skill`, `use_item`, `defend` or `wait`.
   */
  private static readonly GAUGE_ACTIONS: Record<GambitGaugeType, string[]> = {
    attack: ['attack'],
    cast: ['use_skill', 'use_item', 'defend', 'wait'],
  };

  /**
   * Normalize the two gambit shapes present in this codebase into the canonical
   * one the evaluator understands:
   *  - character pages:  { lines: [{ priority, conditions: [condition], action: { id, ... } }] }
   *  - monsters.json:    [{ priority, condition: { type, value }, action: { type, ... } }]
   */
  static normalizeGambitPage(raw: any): { lines: any[] } {
    const lines = Array.isArray(raw) ? raw : Array.isArray(raw?.lines) ? raw.lines : [];

    return {
      lines: lines.map((line: any, index: number) => {
        const conditions = Array.isArray(line?.conditions)
          ? line.conditions
          : line?.condition
            ? [line.condition]
            : [];

        const action = line?.action ?? {};
        const actionId = action.id ?? action.type;

        return {
          priority: line?.priority ?? index + 1,
          conditions: conditions.map((c: any) => ({ ...c, id: c?.id ?? c?.type })),
          action: { ...action, id: actionId },
        };
      }),
    };
  }

  /**
   * Walk the active page top to bottom and return the first line that is both
   * condition-true AND legal for this gauge (SPEC §7.3). Returns null when the
   * combatant has nothing legal to do on this fire (it then idles).
   */
  static evaluateGambitPage(
    gambitPage: any,
    gaugeType: GambitGaugeType,
    self: CombatantSnapshot,
    foe: CombatantSnapshot,
    inventory: Record<string, number> = {},
    itemDefinitions: Record<string, any> = {},
  ): { action: any; line: any } | null {
    const lines = Array.isArray(gambitPage?.lines) ? gambitPage.lines : [];
    if (lines.length === 0) return null;

    const allowedActions = GambitEvaluator.GAUGE_ACTIONS[gaugeType] ?? [];

    // "top to bottom" == ascending priority
    const ordered = [...lines].sort(
      (a: any, b: any) => (a?.priority ?? 999) - (b?.priority ?? 999),
    );

    for (const line of ordered) {
      const action = line?.action;
      if (!action?.id || !allowedActions.includes(action.id)) continue;

      const conditionsMet = GambitEvaluator.evaluateConditions(
        line.conditions,
        self,
        foe,
        inventory,
      );
      if (!conditionsMet) continue;

      // condition-true but illegal -> skip entirely, does not block (§7.3 step 4)
      if (!GambitEvaluator.isActionLegal(action, self, inventory, itemDefinitions)) continue;

      return { action, line };
    }

    return null;
  }
}

/**
 * Battle Engine - Pure deterministic combat simulator (SPEC §7)
 */
export class BattleEngine {
  static readonly BASE_CAST_TICKS = 8;
  static readonly BASIC_ATTACK_CAST_TICKS = 2;
  static readonly POTION_COOLDOWN = 5;
  static readonly DEF_SOFT_CAP = 300;
  static readonly CRIT_MULTIPLIER = 1.5;
  static readonly MIN_ATTACK_GAUGE = 2;
  static readonly MIN_CAST_GAUGE = 3;
  static readonly MIN_ATTACK_DURATION_TICKS = 1;
  static readonly MAX_ATTACK_DURATION_TICKS = 10;
  static readonly MAX_ATTACK_SPEED = 800;
  static readonly MONSTER_CAST_GAUGE = 6;
  static readonly DEFEND_DAMAGE_REDUCTION = 0.3;

  /**
   * Calculate derived stats from base attributes and equipment (SPEC §5)
   */
  static calculateDerivedStats(level: number, attributes: Record<string, number>, equipment: any) {
    const str = Number(attributes['str'] ?? 5);
    const agi = Number(attributes['agi'] ?? 5);
    const dex = Number(attributes['dex'] ?? 5);
    const vit = Number(attributes['vit'] ?? 5);
    const int = Number(attributes['int'] ?? 5);
    const luk = Number(attributes['luk'] ?? 5);
    const maxHp = Math.floor(50 + vit * 18 + Number(equipment?.maxHp ?? 0));
    const maxSp = Math.floor(20 + int * 8 + Number(equipment?.maxSp ?? 0));
    const atk = Math.floor(str * 2 + Number(equipment?.weaponFixedAtk ?? 0));
    const matk = Math.floor(int * 2 + Number(equipment?.weaponFixedMatk ?? 0));
    const def = Math.floor(Number(equipment?.def ?? 0));
    const mdefPercent = Math.min(100, Math.max(0, Number(equipment?.mdefPercent ?? 0)));
    const attackSpeed = 100 + Math.floor(agi * 2);
    const castSpeed = 100 + Math.floor(dex * 2);
    // Canonical Precision/Evasion scale (SPEC §5.2): starting DEX/AGI 5 => 80/100.
    const evasion = 99 + Math.floor(agi / 3);
    const accuracy = 79 + Math.floor(dex / 3) + Number(equipment?.accuracyModifier ?? 0);
    const hpRegenPerTenTicks = 1 + Math.floor(vit / 2);
    const spRegenPerTenTicks = 1 + Math.floor(int / 2);
    const critChance = 1 + Math.floor(luk * 0.3 * 10) / 10;
    return { maxHp, maxSp, atk, matk, def, mdefPercent, accuracy, evasion, critChance,
      attackSpeed, castSpeed, hpRegenPerTenTicks, spRegenPerTenTicks, agi, dex, luk, level };
  }

  /**
   * Build the snapshot of a monster straight from monsters.json.
   * The monster's own hp/atk/def/accuracy/evasion/critChance/atkSpeedTicks are
   * the source of truth - they are NOT re-derived from generic attributes.
   */
  static buildMonsterSnapshot(monsterDefinition: any): CombatantSnapshot {
    const level = Number(monsterDefinition?.level ?? 1);
    return {
      level,
      hp: Number(monsterDefinition?.hp ?? 1),
      sp: Number(monsterDefinition?.maxSp ?? (['Venom Viper', 'Wailing Wraith'].includes(String(monsterDefinition?.name ?? '')) ? 80 : 60)),
      maxHp: Number(monsterDefinition?.hp ?? 1),
      maxSp: Number(monsterDefinition?.maxSp ?? (['Venom Viper', 'Wailing Wraith'].includes(String(monsterDefinition?.name ?? '')) ? 80 : 60)),
      atk: Number(monsterDefinition?.atk ?? 1),
      matk: Number(monsterDefinition?.matk ?? 1),
      def: Number(monsterDefinition?.def ?? 0),
      mdefPercent: Number(monsterDefinition?.mdefPercent ?? 0),
      accuracy: Number(monsterDefinition?.accuracy ?? 50),
      evasion: Number(monsterDefinition?.evasion ?? 0),
      critChance: Number(monsterDefinition?.critChance ?? 1),
      hpRegenPerTenTicks: 0,
      spRegenPerTenTicks: Number(monsterDefinition?.spRegenPerTenTicks ?? 2),
      agi: Number(monsterDefinition?.agi ?? 0),
      dex: Number(monsterDefinition?.dex ?? 0),
      statusEffects: [...(monsterDefinition?.statusEffects ?? [])],
      element: monsterDefinition?.element ?? null,
      combatStyle: monsterDefinition?.combatStyle === 'ranged' ? 'ranged' : 'melee',
      basicAttackDamageType: monsterDefinition?.basicAttackDamageType ?? 'melee',
      basicAttackRange: Number(monsterDefinition?.basicAttackRange ?? 0),
      moveSpeedBase: Number(monsterDefinition?.moveSpeedBase ?? 50) + level - 1,
      moveSpeed: Number(monsterDefinition?.moveSpeedBase ?? 50) + level - 1,
      canMove: monsterDefinition?.canMove !== false,
    };
  }

  /**
   * Calculate physical damage after mitigation (soft-capped DEF, SPEC §7.8)
   */
  static calculatePhysicalDamage(rawDamage: number, def: number): number {
    return rawDamage * (1 - def / (def + BattleEngine.DEF_SOFT_CAP));
  }

  /**
   * Calculate magic damage after mitigation
   */
  static calculateMagicDamage(rawDamage: number, mdefPercent: number): number {
    return rawDamage * (1 - mdefPercent / 100);
  }

  /**
   * Apply the requested small variance to an already-final direct-damage value.
   * The roll is intentionally seeded and belongs after mitigation/multipliers,
   * but before the existing integer rounding and minimum-damage rule.
   * DOT ticks must not call this helper.
   */
  static applyDirectDamageVariance(finalDamage: number, rng: Mulberry32): number {
    const multiplier = 0.99 + rng.next() * 0.02;
    return finalDamage * multiplier;
  }

  /**
   * Calculate hit chance given accuracy and evasion
   */
  static calculateHitChance(accuracy: number, evasion: number): number {
    return Math.max(5, Math.min(95, 100 + accuracy - evasion));
  }

  /**
   * Convert the effective Attack Speed rating into the basic-attack interval.
   * The scale is global and exact at both endpoints: 0 => 10 ticks, 800+ =>
   * 1 tick. Fractional intervals are applied through gauge progress rather than
   * rounded away. Skill/cast timing uses the independent DEX-based cast gauge.
   */
  static attackDurationTicks(attackSpeed: number): number {
    const rawSpeed = Number(attackSpeed ?? 0);
    const effectiveSpeed = Number.isFinite(rawSpeed)
      ? Math.max(0, Math.min(BattleEngine.MAX_ATTACK_SPEED, rawSpeed))
      : 0;
    const duration = BattleEngine.MAX_ATTACK_DURATION_TICKS
      - (effectiveSpeed / BattleEngine.MAX_ATTACK_SPEED)
        * (BattleEngine.MAX_ATTACK_DURATION_TICKS - BattleEngine.MIN_ATTACK_DURATION_TICKS);
    return Math.max(
      BattleEngine.MIN_ATTACK_DURATION_TICKS,
      Math.min(BattleEngine.MAX_ATTACK_DURATION_TICKS, duration),
    );
  }

  /**
   * SPEC §7.2: castGaugeThreshold = 8 - floor(DEX * 0.05), min 3
   */
  static castGaugeThreshold(dex: number): number {
    return Math.max(
      BattleEngine.MIN_CAST_GAUGE,
      BattleEngine.BASE_CAST_TICKS - Math.floor(dex * 0.05),
    );
  }

  /**
   * Cooldown bookkeeping - all decrements happen once per tick (SPEC §7.2)
   */
  private static tickCooldowns(cooldowns: Record<string, number>): void {
    for (const key of Object.keys(cooldowns)) {
      cooldowns[key] -= 1;
      if (cooldowns[key] <= 0) delete cooldowns[key];
    }
  }

  /**
   * Simulate a single battle - pure, deterministic, no Date.now()/Math.random()
   * (SPEC §7). Every gauge fire for BOTH combatants goes through
   * GambitEvaluator.evaluateGambitPage(); nothing is hardcoded.
   *
   * @param characterSnapshot combatant state carried in from the previous battle
   * @param monsterDefinition raw monster row from monsters.json
   * @param gambitPage the character's ACTIVE GambitPage row
   * @param seed deterministic seed
   * @param options.inventory live item counts, mutated to reflect consumption
   * @param options.weaponBaseAttackTicks legacy catalog metadata, retained for compatibility
   */
  static simulateBattle(
    characterSnapshot: CombatantSnapshot,
    monsterDefinition: any,
    gambitPage: any,
    seed: string,
    options: {
      inventory?: Record<string, number>;
      /** Legacy catalog metadata. Character attack intervals now use the universal Attack Speed scale. */
      weaponBaseAttackTicks?: number;
      itemDefinitions?: Record<string, any>;
      monsterSkillDefs?: Record<string, any>;
      statusEffectDefs?: Record<string, Partial<StatusEffectDefinition>>;
      /** Absolute character timeline tick at which this battle starts. */
      regenTickOffset?: number;
    } = {},
  ): {
    outcome: 'win' | 'loss';
    durationTicks: number;
    log: any;
    hpAfter: number;
    spAfter: number;
    inventoryAfter: Record<string, number>;
    itemsConsumed: Array<{ itemId: string; quantity: number }>;
    foodBuffAfter?: { itemId: string; hpRegenPerTenTicks: number; spRegenPerTenTicks: number; remainingTicks: number };
    foodBuffsAfter: Array<{ itemId: string; hpRegenPerTenTicks: number; spRegenPerTenTicks: number; remainingTicks: number }>;
  } {
    const rng = new Mulberry32(seed);
    const inventory: Record<string, number> = { ...(options.inventory ?? {}) };
    const itemDefinitions: Record<string, any> = options.itemDefinitions ?? {};
    const regenTickOffset = Math.max(0, Math.floor(options.regenTickOffset ?? 0));

    // Monsters follow the exact same engine using their own gambit array (§7.3)
    const normalizedGambitPage = GambitEvaluator.normalizeGambitPage(gambitPage);
    const monsterGambitPage = GambitEvaluator.normalizeGambitPage(monsterDefinition?.gambit);
    const monsterSkillDefs: Record<string, any> = options.monsterSkillDefs ?? {};
    const statusEffectDefs: Record<string, Partial<StatusEffectDefinition>> = options.statusEffectDefs ?? {};

    const cooldowns: Record<string, number> = {};

    const self: CombatantSnapshot = {
      ...characterSnapshot,
      isPlayerCharacter: true,
      hp: Math.min(
        characterSnapshot.hp,
        characterSnapshot.maxHp,
      ),
      sp: Math.min(characterSnapshot.sp, characterSnapshot.maxSp),
      statusEffects: [...(characterSnapshot.statusEffects ?? [])],
      cooldowns,
      attackLockTicks: 0,
      castLockTicks: 0,
      defending: false,
      foodBuffTicksRemaining: Math.max(0, Number(characterSnapshot.foodBuffTicksRemaining ?? 0)),
      foodBuffItemId: characterSnapshot.foodBuffItemId,
      foodBuffHpRegenPerTenTicks: characterSnapshot.foodBuffHpRegenPerTenTicks,
      foodBuffSpRegenPerTenTicks: characterSnapshot.foodBuffSpRegenPerTenTicks,
      foodBuffs: Array.isArray(characterSnapshot.foodBuffs)
        ? characterSnapshot.foodBuffs.map((buff: any) => ({ ...buff, remainingTicks: Math.max(0, Number(buff.remainingTicks ?? 0)) })).filter((buff: any) => buff.remainingTicks > 0)
        : (Number(characterSnapshot.foodBuffTicksRemaining ?? 0) > 0 && characterSnapshot.foodBuffItemId ? [{ itemId: String(characterSnapshot.foodBuffItemId), hpRegenPerTenTicks: Number(characterSnapshot.foodBuffHpRegenPerTenTicks ?? 0), spRegenPerTenTicks: Number(characterSnapshot.foodBuffSpRegenPerTenTicks ?? 0), remainingTicks: Number(characterSnapshot.foodBuffTicksRemaining) }] : []),
      foodDigestRemainingTicksByItem: { ...(characterSnapshot.foodDigestRemainingTicksByItem ?? {}) },
    };

    const foeCooldowns: Record<string, number> = {};

    const foe: CombatantSnapshot = {
      ...BattleEngine.buildMonsterSnapshot(monsterDefinition),
      isPlayerCharacter: false,
      cooldowns: foeCooldowns,
      statusEffects: [...(monsterDefinition?.statusEffects ?? [])],
      // Monster skills are all available to the monster; its own gambit decides
      // when to use one. Character skill *unlocking* (§9.1) does not apply here.
      skills: monsterSkillDefs,
      skillDefs: monsterSkillDefs,
    };

    const playerStyle = characterSnapshot.combatStyle === 'ranged' || characterSnapshot.basicAttackDamageType === 'ranged'
      ? 'ranged' : 'melee';
    self.combatStyle = playerStyle;
    self.basicAttackDamageType = characterSnapshot.basicAttackDamageType ?? 'melee';
    self.basicAttackRange = Number(characterSnapshot.basicAttackRange ?? (self.basicAttackDamageType === 'ranged' ? 6 : 0));
    self.position = playerStyle === 'melee' && foe.combatStyle === 'melee' ? 3 : 0;
    foe.position = playerStyle === 'melee' && foe.combatStyle === 'melee' ? 4 : 7;
    self.moveSpeedBase = 50 + Number(self.level ?? 1);
    self.moveSpeed = self.moveSpeedBase;
    self.movementGauge = Number(self.movementGauge ?? 0);
    self.movementIntent = false;
    foe.movementGauge = 0;
    foe.movementIntent = false;
    const distanceBetween = () => Math.max(0, Math.abs(Number(self.position) - Number(foe.position)) - 1);
    const startingPositions = { character: Number(self.position), monster: Number(foe.position) };
    const startingMoveSpeeds = { character: Number(self.moveSpeed), monster: Number(foe.moveSpeed) };
    const startingStyles = { character: self.combatStyle, monster: foe.combatStyle };
    const events: any[] = [];
    const itemsConsumed: Array<{ itemId: string; quantity: number }> = [];

    let attackGauge = 0;
    let castGauge = 0;
    let monsterAttackGauge = 0;
    let monsterCastGauge = 0;
    let lastMonsterSkillId: string | null = null;
    let tick = 0;

    const selfCastThreshold = BattleEngine.castGaugeThreshold(self.dex);
    const monsterAttackThreshold = Math.max(
      BattleEngine.MIN_ATTACK_GAUGE,
      Number(monsterDefinition?.atkSpeedTicks ?? 6),
    );

    // Status definitions own the penalty values. A stackable status contributes
    // its per-stack penalty for each active stack, bounded by its canonical cap.
    const statusAttackSpeedPenalty = (unit: CombatantSnapshot): number => {
      const counts = new Map<string, number>();
      for (const status of unit.statusEffects ?? []) {
        const id = String(status.type ?? status.id ?? '');
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      let total = 0;
      for (const [id, rawCount] of counts) {
        const definition = statusEffectDefs[id] ?? {};
        const stackable = definition.stackable === true;
        const cap = stackable
          ? Math.max(1, Math.floor(Number(definition.maxStacks ?? 1)))
          : 1;
        const count = Math.min(rawCount, cap);
        const firstStatus = (unit.statusEffects ?? []).find(
          (status: any) => String(status.type ?? status.id ?? '') === id,
        );
        const value = Number(stackable
          ? definition.attackSpeedPenaltyPerStack ?? firstStatus?.attackSpeedPenalty ?? 0
          : definition.attackSpeedPenalty ?? firstStatus?.attackSpeedPenalty ?? 0);
        if (Number.isFinite(value) && value > 0) total += value * count;
      }
      return total;
    };
    const selfAttackDurationTicks = (): number => {
      const effectiveSpeed = Math.max(
        0,
        Math.min(
          BattleEngine.MAX_ATTACK_SPEED,
          Number(self.attackSpeed ?? (100 + Math.floor(Number(self.agi ?? 5) * 2))) - statusAttackSpeedPenalty(self),
        ),
      );
      return BattleEngine.attackDurationTicks(effectiveSpeed);
    };
    // Monsters retain their catalogued atkSpeedTicks baseline; the same point
    // penalty adds the equivalent fractional delay to their basic-attack gauge.
    const monsterAttackDurationTicks = (): number => {
      const rage = (foe.statusEffects ?? []).some((status: any) => statusIdOf(status) === 'rage');
      return Math.max(BattleEngine.MIN_ATTACK_DURATION_TICKS, (monsterAttackThreshold + statusAttackSpeedPenalty(foe) * 9 / BattleEngine.MAX_ATTACK_SPEED) / (rage ? 2 : 1));
    };

    const damageTakenMultiplier = monsterDefinition?.damageTakenMultiplier ?? {};
    const meleeMult = Number(damageTakenMultiplier.melee ?? 1);
    const rangedMult = Number(damageTakenMultiplier.ranged ?? 1);
    const magicMult = Number(damageTakenMultiplier.magic ?? 1);
    const elementalDamageMultiplier = (element: any): number => {
      if (!element) return 1;
      const configured = Number(monsterDefinition?.elementalDamageTakenMultiplier?.[String(element)]);
      if (Number.isFinite(configured) && configured >= 0) return configured;
      const weaponless = monsterDefinition?.elementalResistances ?? [];
      return Array.isArray(weaponless) && weaponless.includes(String(element)) ? 0.5 : 1;
    };
    const weaponCategoryMultiplier = (category: any): number => {
      const key = String(category ?? '');
      const value = Number(monsterDefinition?.weaponCategoryDamageTakenMultiplier?.[key]);
      return Number.isFinite(value) && value >= 0 ? value : 1;
    };

    const record = (event: any) => {
      events.push({
        ...event,
        hpRemaining: { character: self.hp, monster: foe.hp },
        spRemaining: { character: self.sp, monster: foe.sp },
      });
    };

    const statusIdOf = (status: any) => String(status?.type ?? status?.id ?? '');
    const chanceAfterSaveButtLuck = (baseChance: number, targetLuk: number, enabled: boolean): number =>
      Math.max(0, Math.min(1, baseChance) - (enabled ? Math.min(10, Math.max(0, targetLuk)) / 100 : 0));
    const hasStatus = (unit: CombatantSnapshot, statusId: string) =>
      (unit.statusEffects ?? []).some((status: any) => statusIdOf(status) === statusId);
    const countStatus = (unit: CombatantSnapshot, statusId: string) =>
      (unit.statusEffects ?? []).filter((status: any) => statusIdOf(status) === statusId).length;

    const applyStatus = (
      target: CombatantSnapshot,
      statusId: string,
      sourceSkillId: string,
      durationTicks?: number,
      extra: Record<string, any> = {},
      appliedBy: 'character' | 'monster' = 'character',
    ): boolean => {
      const definition = statusEffectDefs[statusId] ?? {};
      const current = target.statusEffects ?? [];
      const existing = current.filter((status: any) => statusIdOf(status) === statusId);
      const stackable = definition.stackable === true;
      const maxStacks = stackable ? Math.max(1, Number(definition.maxStacks ?? 1)) : 1;
      if (stackable && existing.length >= maxStacks) return false;
      if (!stackable && existing.length && definition.reapplication !== 'refresh') return false;

      const remaining = stackable || !existing.length
        ? current
        : current.filter((status: any) => statusIdOf(status) !== statusId);
      const resolvedDuration = durationTicks ?? Number(definition.statusDurationTicks ?? 0);
      const instance: Record<string, any> = {
        type: statusId,
        appliedAtTick: tick,
        sourceSkillId,
        sourceActor: appliedBy,
        ...extra,
      };
      if (resolvedDuration > 0) instance.expiresAtTick = tick + resolvedDuration;
      target.statusEffects = [...remaining, instance];
      record({
        tick,
        actor: appliedBy,
        action: existing.length && definition.reapplication === 'refresh'
          ? 'status_refreshed'
          : stackable ? 'status_stack_applied' : 'status_applied',
        status: statusId,
        target: target === self ? 'character' : 'monster',
        ...(stackable ? { stackCount: countStatus(target, statusId) } : {}),
        ...(resolvedDuration > 0 ? { durationTicks: resolvedDuration, expiresAtTick: tick + resolvedDuration } : {}),
        sourceSkillId,
        statusStackable: stackable,
      });
      if (target === foe && statusId === 'disarm' && monsterDefinition?.id === 'mon_brokensentinel') {
        applyStatus(foe, 'physical_reflection', 'monster_skill_physical_reflection', 15, { reflectPercent: 30 }, 'monster');
      }
      return true;
    };

    const effectiveDefense = (unit: CombatantSnapshot): number =>
      Number(unit.def ?? 0) + (unit.statusEffects ?? []).reduce(
        (total: number, status: any) => total + Math.max(0, Number(status.defBonus ?? 0)),
        0,
      );
    const effectiveAttack = (unit: CombatantSnapshot): number =>
      Number(unit.atk ?? 0) + (unit.statusEffects ?? []).reduce((total: number, status: any) => total + Number(status.atkBonus ?? 0), 0);

    const reflectMonsterDamage = (damage: number, damageType: string): void => {
      if (damage <= 0 || self.hp <= 0) return;
      const statusId = damageType === 'magic' ? 'magic_reflection' : 'physical_reflection';
      const status = (foe.statusEffects ?? []).find((entry: any) => statusIdOf(entry) === statusId);
      if (!status) return;
      const raw = damage * Math.max(0, Number(status.reflectPercent ?? 30)) / 100;
      const mitigated = damageType === 'magic'
        ? BattleEngine.calculateMagicDamage(raw, self.mdefPercent)
        : BattleEngine.calculatePhysicalDamage(raw, effectiveDefense(self));
      const reflected = Math.max(0, Math.floor(mitigated));
      self.hp = Math.max(0, self.hp - reflected);
      record({ tick, actor: 'monster', action: 'damage_reflected', sourceSkillId: status.sourceSkillId, target: 'character', damage: reflected, damageType, hit: true, nonRecursive: true });
    };

    const absorbMagicDamage = (
      target: CombatantSnapshot,
      damageType: string,
      incomingDamage: number,
    ): { damage: number; absorbed: number } => {
      if (damageType !== 'magic' || incomingDamage <= 0) {
        return { damage: Math.max(0, incomingDamage), absorbed: 0 };
      }
      const barrier = (target.statusEffects ?? []).find((status: any) => statusIdOf(status) === 'magic_barrier');
      if (!barrier) return { damage: Math.max(0, incomingDamage), absorbed: 0 };
      const remaining = Math.max(0, Number(barrier.absorbRemaining ?? 0));
      const absorbed = Math.min(remaining, incomingDamage);
      if (absorbed <= 0) return { damage: Math.max(0, incomingDamage), absorbed: 0 };
      barrier.absorbRemaining = remaining - absorbed;
      const targetLabel = target === self ? 'character' : 'monster';
      record({
        tick,
        actor: targetLabel,
        action: 'magic_barrier_absorbed',
        target: targetLabel,
        status: 'magic_barrier',
        absorbed,
        absorbRemaining: barrier.absorbRemaining,
        sourceSkillId: barrier.sourceSkillId,
      });
      if (barrier.absorbRemaining <= 0) {
        target.statusEffects = (target.statusEffects ?? []).filter((status: any) => status !== barrier);
        record({ tick, actor: targetLabel, action: 'status_ended', status: 'magic_barrier', target: targetLabel, sourceSkillId: barrier.sourceSkillId });
      }
      return { damage: Math.max(0, incomingDamage - absorbed), absorbed };
    };

    const tickDamageStatuses = (unit: CombatantSnapshot) => {
      for (const status of [...(unit.statusEffects ?? [])] as any[]) {
        const interval = Math.max(0, Number(status.damageIntervalTicks ?? 0));
        const dueAt = Number(status.nextDamageAtTick ?? Number.POSITIVE_INFINITY);
        if (interval <= 0 || tick < dueAt || Number(status.damagePerTick ?? 0) <= 0) continue;
        const rawDamage = Math.max(0, Math.floor(Number(status.damagePerTick)));
        const damage = status.damageType === 'magic' ? Math.floor(BattleEngine.calculateMagicDamage(rawDamage, unit.mdefPercent)) : rawDamage;
        unit.hp = Math.max(0, unit.hp - damage);
        status.nextDamageAtTick = dueAt + interval;
        record({
          tick,
          actor: status.sourceActor ?? (unit === self ? 'monster' : 'character'),
          action: 'status_damage',
          status: statusIdOf(status),
          sourceSkillId: status.sourceSkillId,
          target: unit === self ? 'character' : 'monster',
          damage,
          damageType: String(status.damageType ?? (statusIdOf(status) === 'bleed' ? 'pure' : 'status')),
          ignoresDefense: status.damageType === 'pure' || statusIdOf(status) === 'bleed',
          hit: true,
        });
      }
    };

    /**
     * Approach is movement intent, not an attack/cast execution. Resolve the
     * currently legal target action for each gauge every tick so a distant
     * character starts walking immediately rather than waiting for the next
     * attack/cast gauge fire. If no target action is legal, clear stale intent.
     */
    const refreshApproachIntent = (
      unit: CombatantSnapshot,
      target: CombatantSnapshot,
      page: any,
      unitInventory: Record<string, number>,
      unitItemDefinitions: Record<string, any>,
    ) => {
      const choices = [
        GambitEvaluator.evaluateGambitPage(page, 'attack', unit, target, unitInventory, unitItemDefinitions),
        GambitEvaluator.evaluateGambitPage(page, 'cast', unit, target, unitInventory, unitItemDefinitions),
      ].filter(Boolean) as Array<{ action: any; line: any }>;
      const neededRanges: number[] = [];
      let hasTargetActionInRange = false;

      for (const choice of choices) {
        const action = choice.action;
        if (action.id === 'attack') {
          const range = Math.max(0, Number(unit.basicAttackRange ?? 0));
          if (distanceBetween() <= range) hasTargetActionInRange = true;
          else neededRanges.push(range);
          continue;
        }
        if (action.id !== 'use_skill') continue;
        const skillId = String(action.skillId ?? action.params?.skillId ?? '');
        const definition: any = unit.skillDefs?.[skillId] ?? unit.skills?.[skillId] ?? {};
        const effectType = String(definition.effect?.type ?? '');
        if (definition.target === 'self' || ['self_heal', 'defense_buff', 'magic_barrier', 'arcane_dynamo_passive'].includes(effectType)) {
          continue;
        }
        // Blinkstrike is itself the approach movement and may execute at any distance.
        if (effectType === 'blinkstrike') {
          hasTargetActionInRange = true;
          continue;
        }
        const range = definition.ranged === true
          ? Math.max(0, Number(definition.maxRange ?? 7) - 1)
          : Math.max(0, Number(definition.maxRange ?? 1) - 1);
        if (distanceBetween() <= range) hasTargetActionInRange = true;
        else neededRanges.push(range);
      }

      if (hasTargetActionInRange || neededRanges.length === 0 || target.hp <= 0 || hasStatus(unit, 'stun')) {
        unit.movementIntent = false;
        unit.movementIntentRange = undefined;
        return;
      }
      unit.movementIntent = true;
      // Approach only as far as the most permissive presently legal target action needs.
      unit.movementIntentRange = Math.max(...neededRanges);
    };


    // There is no duration/tick cap: a battle ends only when one combatant reaches 0 HP.
    while (self.hp > 0 && foe.hp > 0) {
      // Expire timed statuses before this tick's actions. Stackable statuses report each
      // lost stack; the final lost stack uses the same explicit "ended" event as other statuses.
      for (const [unit, actor] of [[self, 'character'], [foe, 'monster']] as Array<[CombatantSnapshot, string]>) {
        const statuses = unit.statusEffects ?? [];
        const expired = statuses.filter((status: any) => Number(status.expiresAtTick ?? Infinity) <= tick);
        const remainingByStatus = new Map<string, number>();
        for (const status of statuses) {
          const statusId = String(status.type ?? status.id ?? '');
          remainingByStatus.set(statusId, (remainingByStatus.get(statusId) ?? 0) + 1);
        }
        for (const status of expired) {
          const statusId = String(status.type ?? status.id ?? '');
          const statusDef = statusEffectDefs[statusId] ?? {};
          const remainingCount = Math.max(0, (remainingByStatus.get(statusId) ?? 1) - 1);
          remainingByStatus.set(statusId, remainingCount);
          const common = {
            tick,
            actor,
            target: unit === self ? 'character' : 'monster',
            status: statusId,
            sourceSkillId: status.sourceSkillId,
            expiredAtTick: status.expiresAtTick,
            expiredAppliedAtTick: status.appliedAtTick,
            moveSpeedPenalty: Number(status.moveSpeedPenalty ?? statusDef.moveSpeedPenaltyPerStack ?? statusDef.moveSpeedPenalty ?? 0),
            attackSpeedPenalty: Number(status.attackSpeedPenalty ?? (statusDef.stackable === true ? statusDef.attackSpeedPenaltyPerStack : statusDef.attackSpeedPenalty) ?? 0),
            statusStackable: statusDef.stackable === true,
          };
          if (statusDef.stackable === true && remainingCount > 0) {
            record({ ...common, action: 'status_stack_lessened', stackCount: remainingCount });
          } else {
            record({
              ...common,
              action: 'status_ended',
              ...(statusDef.stackable === true ? { stackCount: 0 } : {}),
            });
          }
        }
        unit.statusEffects = statuses.filter((status: any) => Number(status.expiresAtTick ?? Infinity) > tick);
      }
      // Periodic damage is applied once per scheduled status tick, never as a new
      // action; it therefore cannot mint extra Mastery action XP.
      tickDamageStatuses(self);
      tickDamageStatuses(foe);
      // Conditions like `every_n_ticks` are tick-indexed (SPEC §7.1)
      self.tick = tick;
      foe.tick = tick;
      BattleEngine.tickCooldowns(cooldowns);
      const monsterCooldownsExpiring = new Set(Object.keys(foeCooldowns).filter((key) => Number(foeCooldowns[key]) === 1));
      BattleEngine.tickCooldowns(foeCooldowns);

      // Evaluate this tick's cast choice before processing the basic-attack
      // gauge. A selected, ready skill in range owns the tick, so a basic
      // attack cannot resolve before/alongside it. Its Attack gauge restarts
      // after the skill action rather than firing on the same tick.
      const characterCastChoice = GambitEvaluator.evaluateGambitPage(
        normalizedGambitPage, 'cast', self, foe, inventory, itemDefinitions,
      );
      const prioritySkillId = characterCastChoice?.action?.skillId ?? characterCastChoice?.action?.params?.skillId;
      const prioritySkillDef = prioritySkillId ? (self.skillDefs?.[prioritySkillId] ?? {}) : {};
      const prioritySkillRange = prioritySkillDef.ranged === true
        ? Math.max(0, Number(prioritySkillDef.maxRange ?? 7) - 1)
        : Math.max(0, Number(prioritySkillDef.maxRange ?? 1) - 1);
      const prioritySkillSelfTarget = prioritySkillDef.target === 'self';
      const prioritySkillBlinkstrike = prioritySkillDef.effect?.type === 'blinkstrike';
      const characterSkillHasCastPriority = (self.castLockTicks ?? 0) <= 0
        && characterCastChoice?.action?.id === 'use_skill'
        && (prioritySkillSelfTarget || prioritySkillBlinkstrike || distanceBetween() <= prioritySkillRange);

      // ===== CHARACTER: ATTACK GAUGE =====
      // SPEC §7.2: while that gauge's action is resolving, the gauge is locked
      // at zero and refilling restarts once the action resolves.
      if (characterSkillHasCastPriority) {
        // Do not let Attack resolve on the same tick as the selected skill.
        attackGauge = 0;
      } else if ((self.attackLockTicks ?? 0) <= 0) {
        // Recompute every tick so status application/stack loss/expiry changes
        // only the future refill rate while preserving already-earned progress.
        attackGauge += 1 / selfAttackDurationTicks();
        if (attackGauge >= 1) {
          attackGauge = 0;
          const choice = GambitEvaluator.evaluateGambitPage(
            normalizedGambitPage,
            'attack',
            self,
            foe,
            inventory,
            itemDefinitions,
          );

          if (choice && choice.action.id === 'attack' && distanceBetween() > Number(self.basicAttackRange ?? 0)) {
            self.movementIntent = true;
            self.movementIntentRange = Number(self.basicAttackRange ?? 0);
          } else if (choice && choice.action.id === 'attack') {
            self.movementIntent = false;
            self.movementIntentRange = undefined;
            const distanceAtActionStart = distanceBetween();
            const fearlessRank = Math.max(0, Number(self.skillDefs?.fearless_focus?.masteryRank ?? 0));
            const precisionUsed = Number(self.accuracy) + distanceAtActionStart * fearlessRank;
            const hitChance = BattleEngine.calculateHitChance(precisionUsed, foe.evasion);
            const landed = rng.chance(hitChance / 100);
            const crit = landed && rng.chance(self.critChance / 100);
            const attackType = self.basicAttackDamageType ?? 'melee';
            const fearlessDamageMultiplier = 1 + fearlessRank * distanceAtActionStart * 0.01;
            const baseDamage = self.atk * (crit ? BattleEngine.CRIT_MULTIPLIER : 1) * fearlessDamageMultiplier;
            const daggerHands = (self.masteryEquipment ?? []).filter((hand) => hand.category === 'dagger').length;
            const doubleStrikeRank = Math.max(0, Number(self.skillDefs?.double_strike?.masteryRank ?? 0));
            const doubleStrikeChance = Math.min(1, daggerHands * doubleStrikeRank * 0.05);
            const doubleStrikeTriggered = landed && doubleStrikeRank > 0 && daggerHands > 0 && rng.chance(doubleStrikeChance);
            const componentCount = doubleStrikeTriggered ? 2 : 1;
            const damageComponents: number[] = [];
            const mitigation = attackType === 'magic'
              ? BattleEngine.calculateMagicDamage(baseDamage, foe.mdefPercent)
              : BattleEngine.calculatePhysicalDamage(baseDamage, effectiveDefense(foe));
            const weaponCategory = (self.equippedWeaponTypes ?? []).find((type: string) => !['shield', 'rune'].includes(type));
            const finalDamage = mitigation * (attackType === 'ranged' ? rangedMult : attackType === 'magic' ? magicMult : meleeMult) * weaponCategoryMultiplier(weaponCategory);
            for (let component = 0; component < componentCount; component += 1) {
              damageComponents.push(landed
                ? Math.max(1, Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)))
                : 0);
            }
            const damage = damageComponents.reduce((sum, value) => sum + value, 0);
            foe.hp = Math.max(0, foe.hp - damage);

            record({
              tick,
              actor: 'character',
              action: 'attack',
              target: 'monster',
              damage,
              ...(doubleStrikeTriggered ? { damageComponents, doubleStrikeTriggered: true } : {}),
              ...(fearlessRank > 0 ? { distanceAtActionStart, precisionUsed, fearlessDamageMultiplier } : {}),
              damageType: attackType,
              crit,
              hit: landed,
            });

            const swordsmanshipRank = Math.max(0, Number(self.skillDefs?.swordsmanship?.masteryRank ?? 0));
            const bleedDefinition = statusEffectDefs.bleed ?? {};
            const bleedMaxStacks = Math.max(1, Number(bleedDefinition.maxStacks ?? 5));
            const bleedIntervalTicks = Math.max(1, Number(bleedDefinition.damageIntervalTicks ?? 5));
            if (landed && swordsmanshipRank > 0 && countStatus(foe, 'bleed') < bleedMaxStacks && rng.chance(Number(bleedDefinition.procChancePerRank ?? 0.01) * swordsmanshipRank)) {
              applyStatus(
                foe,
                'bleed',
                'swordsmanship',
                undefined,
                {
                  damagePerTick: Number(bleedDefinition.damagePerStack ?? 5) * swordsmanshipRank,
                  damageIntervalTicks: bleedIntervalTicks,
                  damageType: String(bleedDefinition.damageType ?? 'pure'),
                  nextDamageAtTick: tick + bleedIntervalTicks,
                },
                'character',
              );
            }
            const arcaneDynamoRank = Math.max(0, Number(self.skillDefs?.arcane_dynamo?.masteryRank ?? 0));
            if (landed && arcaneDynamoRank > 0) {
              const beforeRefund = self.sp;
              self.sp = Math.min(self.maxSp, self.sp + 2 * arcaneDynamoRank);
              if (self.sp > beforeRefund) record({ tick, actor: 'character', action: 'sp_refund', sourceSkillId: 'arcane_dynamo', target: 'character', spRestored: self.sp - beforeRefund });
            }

            self.attackLockTicks = BattleEngine.BASIC_ATTACK_CAST_TICKS;
          }
          // SPEC §7.3 step 5: no line qualifies -> wasted fire, gauge still resets
        }
      }

      // ===== CHARACTER: CAST GAUGE =====
      if ((self.castLockTicks ?? 0) <= 0) {
        castGauge += 1;
        if (castGauge >= selfCastThreshold) {
          castGauge = 0;
          // If the skill was not granted exclusive priority before Attack,
          // re-evaluate after Attack resolves: passives such as Arcane Dynamo
          // can change SP and therefore alter cast-gauge legality on this tick.
          const choice = characterSkillHasCastPriority
            ? characterCastChoice
            : GambitEvaluator.evaluateGambitPage(
              normalizedGambitPage, 'cast', self, foe, inventory, itemDefinitions,
            );

          const selectedSkillId = choice?.action?.skillId ?? choice?.action?.params?.skillId;
          const selectedSkillDef = selectedSkillId ? (self.skillDefs?.[selectedSkillId] ?? {}) : {};
          // Ranged skill maxRange counts the target's occupied space; the lane distance API counts only empty spaces.
          const selectedSkillRange = selectedSkillDef.ranged === true
            ? Math.max(0, Number(selectedSkillDef.maxRange ?? 7) - 1)
            : Math.max(0, Number(selectedSkillDef.maxRange ?? 1) - 1);
          const selfTargetSkill = selectedSkillDef.target === 'self';
          const blinkstrikeSkill = selectedSkillDef.effect?.type === 'blinkstrike';
          const skillOutOfRange = choice?.action?.id === 'use_skill' && !selfTargetSkill && !blinkstrikeSkill && distanceBetween() > selectedSkillRange;
          if (skillOutOfRange) {
            self.movementIntent = true;
            self.movementIntentRange = selectedSkillRange;
          }
          if (choice && !skillOutOfRange) {
            const action = choice.action;
            const params = (action as any);
            if (action.id === 'use_skill') { self.movementIntent = false; self.movementIntentRange = undefined; }

            if (action.id === 'use_item') {
              const itemId = params.itemId ?? params.params?.itemId;
              inventory[itemId] = Math.max(0, (inventory[itemId] ?? 0) - 1);
              const existing = itemsConsumed.find((c) => c.itemId === itemId);
              if (existing) existing.quantity += 1;
              else itemsConsumed.push({ itemId, quantity: 1 });

              // Potions share one 5-tick cooldown CATEGORY (SPEC §7.2)
              const def = itemDefinitions[itemId] ?? {};
              const effectType = String(def.effect?.type ?? '');
              const isPotion = def.type === 'consumable' && ['heal_hp', 'heal_sp', 'heal_hp_sp'].includes(effectType);
              if (isPotion) {
                cooldowns['item:potion'] = Number(def.cooldownInSeconds ?? def.cooldownSeconds ?? BattleEngine.POTION_COOLDOWN);
              } else {
                const cooldownTicks = Number(def.cooldownInSeconds ?? def.cooldownSeconds ?? 0);
                if (cooldownTicks > 0) cooldowns[`item:${itemId}`] = cooldownTicks;
              }

              const amount = Number(def.effect?.amount ?? 0);
              if (effectType === 'heal_hp') {
                const before = self.hp;
                self.hp = Math.min(self.maxHp, self.hp + amount);
                record({
                  tick,
                  actor: 'character',
                  action: 'use_item',
                  itemId,
                  target: 'character',
                  healAmount: self.hp - before,
                });
              } else if (effectType === 'heal_sp') {
                const before = self.sp;
                self.sp = Math.min(self.maxSp, self.sp + amount);
                record({
                  tick,
                  actor: 'character',
                  action: 'use_item',
                  itemId,
                  target: 'character',
                  spGain: self.sp - before,
                });
              } else if (effectType === 'food_buff') {
                const foodDurationTicks = Math.max(0, Number(def.effect?.durationSeconds ?? 0));
                self.foodDigestRemainingTicksByItem = {
                  ...(self.foodDigestRemainingTicksByItem ?? {}),
                  [itemId]: foodDurationTicks,
                };
                const dietLevels = self.dietLevelByFood ?? {};
                const hasConsumedBefore = Object.prototype.hasOwnProperty.call(dietLevels, itemId);
                const currentDietLevel = Math.max(0, Math.min(3, Number(dietLevels[itemId] ?? 0)));
                const nextDietLevel = hasConsumedBefore ? Math.min(3, currentDietLevel + 1) : 0;
                self.dietLevelByFood = { ...dietLevels, [itemId]: nextDietLevel };
                const newFoodBuff = {
                  itemId: String(itemId),
                  hpRegenPerTenTicks: effectiveFoodStatValue(def.effect?.hpRegenPerTenTicks, nextDietLevel),
                  spRegenPerTenTicks: effectiveFoodStatValue(def.effect?.spRegenPerTenTicks, nextDietLevel),
                  remainingTicks: foodDurationTicks,
                };
                self.foodBuffs = [...(self.foodBuffs ?? []).filter((buff: any) => buff.itemId !== itemId), newFoodBuff];
                // Keep the legacy singular fields synchronized to the most recently eaten item.
                self.foodBuffTicksRemaining = foodDurationTicks;
                self.foodBuffItemId = String(itemId);
                self.foodBuffHpRegenPerTenTicks = newFoodBuff.hpRegenPerTenTicks;
                self.foodBuffSpRegenPerTenTicks = newFoodBuff.spRegenPerTenTicks;
                record({
                  tick,
                  actor: 'character',
                  action: 'use_item',
                  itemId,
                  target: 'character',
                  foodBuffApplied: true,
                  foodBuffTicksRemaining: self.foodBuffTicksRemaining,
                });
              } else if (effectType === 'cure_status' && def.effect?.status) {
                self.statusEffects = (self.statusEffects ?? []).filter(
                  (s: any) => (s.type ?? s.id) !== def.effect.status,
                );
                record({
                  tick,
                  actor: 'character',
                  action: 'use_item',
                  itemId,
                  target: 'character',
                  curedStatus: def.effect.status,
                });
              } else {
                record({
                  tick,
                  actor: 'character',
                  action: 'use_item',
                  itemId,
                  target: 'character',
                });
              }

              self.castLockTicks = 1;
            } else if (action.id === 'use_skill') {
              const skillId = params.skillId ?? params.params?.skillId;
              const def = self.skillDefs?.[skillId] ?? {};
              const rank = Math.max(1, Number(def.masteryRank ?? 1));
              const effect = def.effect ?? {};
              const spCost = Math.max(0, Number(def.spCost ?? 0));
              const baseSpCost = Math.max(0, Number(def.baseSpCost ?? spCost));
              const spBeforeSkillCost = self.sp;
              self.sp = Math.max(0, self.sp - spCost);
              cooldowns['skill:' + skillId] = Number(def.cooldownTicks ?? 0) + (Number(def.cooldownTicks ?? 0) > 0 ? 1 : 0);
              self.castLockTicks = Math.max(1, Number(def.baseCastTicks ?? 2));

              const effectType = String(effect.type ?? '');
              const refundArcaneDynamo = () => {
                const passiveRank = Math.max(0, Number(self.skillDefs?.arcane_dynamo?.masteryRank ?? 0));
                if (passiveRank <= 0) return;
                const beforeRefund = self.sp;
                self.sp = Math.min(self.maxSp, self.sp + 2 * passiveRank);
                if (self.sp > beforeRefund) record({ tick, actor: 'character', action: 'sp_refund', sourceSkillId: 'arcane_dynamo', target: 'character', spRestored: self.sp - beforeRefund });
              };
              if (effectType === 'defense_buff') {
                applyStatus(self, 'war_cry_def', skillId, Number(effect.durationTicks ?? 10), {
                  defBonus: Number(effect.defBonusPerRank ?? 10) * rank,
                }, 'character');
                record({
                  tick, actor: 'character', action: 'use_skill', skillId, target: 'character',
                  damage: 0, hit: true, crit: false, spSpent: spCost, baseSpCost,
                  statusApplied: 'war_cry_def', defBonus: Number(effect.defBonusPerRank ?? 10) * rank,
                });
              } else if (effectType === 'arcane_dynamo_passive') {
                // Passive only; it does not itself create an action or consume SP.
                record({ tick, actor: 'character', action: 'use_skill', skillId, target: 'character', damage: 0, hit: true, spSpent: spCost, baseSpCost });
              } else if (effectType === 'self_heal') {
                const heal = Math.max(0, Number(effect.flatPerRank ?? 50) * rank
                  + Math.floor(self.maxHp * Math.floor(Number(self.matk ?? 0) / Math.max(1, Number(effect.matkScaleDenominator ?? 20))) / 100));
                const hpBefore = self.hp;
                self.hp = Math.min(self.maxHp, self.hp + heal);
                record({
                  tick, actor: 'character', action: 'use_skill', skillId, target: 'character',
                  healAmount: self.hp - hpBefore, hit: true, crit: false, spSpent: spCost, baseSpCost,
                });
              } else if (effectType === 'magic_barrier') {
                const absorbAmount = Math.max(0, Number(effect.absorbPerRank ?? 100) * rank);
                applyStatus(self, 'magic_barrier', skillId, Number(effect.durationTicks ?? 300), {
                  absorbRemaining: absorbAmount,
                }, 'character');
                record({
                  tick, actor: 'character', action: 'use_skill', skillId, target: 'character',
                  damage: 0, hit: true, crit: false, spSpent: spCost, baseSpCost,
                  barrierApplied: absorbAmount, durationTicks: Number(effect.durationTicks ?? 300),
                });
              } else {
                if (effectType === 'blinkstrike') {
                  const previousPosition: number = Number(self.position ?? 0);
                  const targetPosition: number = Number(foe.position ?? 0);
                  const direction: number = targetPosition > previousPosition ? 1 : -1;
                  const inFrontPosition: number = targetPosition - direction;
                  if (inFrontPosition >= 0 && inFrontPosition <= 7 && inFrontPosition !== targetPosition && previousPosition !== inFrontPosition) {
                    const distanceBefore = distanceBetween();
                    self.position = inFrontPosition;
                    self.movementIntent = false;
                    self.movementIntentRange = undefined;
                    record({
                      tick, actor: 'character', action: 'move', fromPosition: previousPosition,
                      toPosition: inFrontPosition, spacesMoved: Math.abs(inFrontPosition - previousPosition),
                      direction: inFrontPosition > previousPosition ? 'right' : 'left',
                      distanceBefore, distanceAfter: distanceBetween(), reason: 'blinkstrike',
                      sourceSkillId: skillId,
                    });
                  }
                }

                let raw = Number(self.atk ?? 0);
                if (effectType === 'physical_damage') {
                  raw = effect.multiplierPerRank === true
                    ? Number(self.atk ?? 0) * rank
                    : Number(self.atk ?? 0) * Number(effect.atkMultiplier ?? 1)
                      + Number(effect.flatPerRank ?? 0) * rank;
                } else if (effectType === 'physical_push') {
                  raw = Number(effect.damagePerRank ?? 50) * rank;
                } else if (effectType === 'magic_damage') {
                  raw = Number(self.matk ?? 0) + Number(effect.flatPerRank ?? 0) * rank;
                } else if (effectType === 'magic_damage_remaining_sp') {
                  raw = Number(self.matk ?? 0) + Number(self.sp ?? 0);
                } else if (effectType === 'magic_damage_light_wisp') {
                  raw = Number(self.matk ?? 0) + 25 * rank + Math.floor(spBeforeSkillCost / 5);
                } else if (effectType === 'blinkstrike') {
                  raw = Number(self.atk ?? 0);
                }

                const damageType = String(def.damageType ?? (effectType.startsWith('magic_') ? 'magic' : 'melee'));
                const isMagic = damageType === 'magic';
                const mitigation = isMagic
                  ? BattleEngine.calculateMagicDamage(raw, foe.mdefPercent)
                  : BattleEngine.calculatePhysicalDamage(raw, effectiveDefense(foe));
                const archetypeMultiplier = isMagic ? magicMult : damageType === 'ranged' ? rangedMult : meleeMult;
                const elementMultiplier = elementalDamageMultiplier(def.element);
                const weaponCategory = (self.equippedWeaponTypes ?? []).find((type: string) => !['shield', 'rune'].includes(type));
                const finalDamage = mitigation * archetypeMultiplier * elementMultiplier * weaponCategoryMultiplier(weaponCategory);
                const rolledDamage = Math.max(0, Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)));
                const barrierResult = absorbMagicDamage(foe, damageType, rolledDamage);
                const damage = Math.max(0, barrierResult.damage);
                foe.hp = Math.max(0, foe.hp - damage);

                record({
                  tick, actor: 'character', action: 'use_skill', skillId, target: 'monster',
                  damage, damageAbsorbed: barrierResult.absorbed || undefined, damageType,
                  crit: false, hit: true, spSpent: spCost, baseSpCost,
                  ...(effectType === 'physical_push' ? { pushDistanceTarget: Number(effect.targetDistance ?? 6) } : {}),
                });

                if (monsterDefinition?.id === 'mon_ruinsguardian' && foe.hp > 0) {
                  applyStatus(foe, 'prowess', 'monster_skill_prowess', 20, { atkBonus: 10, defBonus: 10 }, 'monster');
                }
                reflectMonsterDamage(damage, damageType);
                const appliedStatusId = String(effect.applyStatus ?? '');
                if (appliedStatusId && foe.hp > 0 && statusEffectDefs[appliedStatusId]) {
                  const statusDefinition = statusEffectDefs[appliedStatusId] ?? {};
                  const existingStatuses = (foe.statusEffects ?? []).filter(
                    (status: any) => statusIdOf(status) === appliedStatusId,
                  );
                  const stackable = statusDefinition.stackable === true;
                  const maxStacks = stackable ? Math.max(1, Math.floor(Number(statusDefinition.maxStacks ?? 1))) : 1;
                  const canApply = stackable
                    ? existingStatuses.length < maxStacks
                    : existingStatuses.length === 0 || statusDefinition.reapplication === 'refresh';
                  if (canApply) {
                    const baseStatusChance = Math.max(0, Math.min(1, Number(effect.statusChance ?? 1)));
                    const statusChance = chanceAfterSaveButtLuck(baseStatusChance, Number(foe.luk ?? 0), effect.saveButtLuck === true);
                    if (statusChance >= 1 || rng.chance(statusChance)) {
                      const durationByRank = effect.statusDurationTicksByRank;
                      const configuredDuration = Array.isArray(durationByRank)
                        ? durationByRank[Math.min(rank, durationByRank.length) - 1]
                        : effect.statusDurationTicks;
                      applyStatus(
                        foe,
                        appliedStatusId,
                        skillId,
                        configuredDuration === undefined ? undefined : Math.floor(Number(configuredDuration)),
                        {},
                        'character',
                      );
                    }
                  }
                }

                const burnChance = Math.max(0, Math.min(1, Number(effect.burnChance ?? 0)));
                if (burnChance > 0 && foe.hp > 0 && rng.chance(burnChance)) {
                  const interval = Number(effect.burnIntervalTicks ?? 5);
                  applyStatus(foe, 'burn', skillId, Number(effect.burnDurationTicks ?? 25), {
                    damagePerTick: Number(self.matk ?? 0),
                    damageIntervalTicks: interval,
                    nextDamageAtTick: tick + interval,
                  }, 'character');
                }

                if (effectType === 'physical_push' && foe.hp > 0) {
                  const startingPosition = Number(foe.position ?? 0);
                  const characterPosition = Number(self.position ?? 0);
                  const awayDirection = startingPosition >= characterPosition ? 1 : -1;
                  const targetDistance = Math.max(0, Number(effect.targetDistance ?? 6));
                  const beforePushDistance = distanceBetween();
                  // Move away using the established eight-position lane. Stop at the
                  // requested empty-space distance or the lane edge, whichever comes first.
                  while (distanceBetween() < targetDistance) {
                    const nextPosition: number = Number(foe.position ?? 0) + awayDirection;
                    if (nextPosition < 0 || nextPosition > 7 || nextPosition === Number(self.position)) break;
                    foe.position = nextPosition;
                  }
                  if (Number(foe.position) !== startingPosition) {
                    record({
                      tick, actor: 'character', action: 'move', fromPosition: startingPosition,
                      toPosition: Number(foe.position), spacesMoved: Math.abs(Number(foe.position) - startingPosition),
                      direction: Number(foe.position) > startingPosition ? 'right' : 'left',
                      distanceBefore: beforePushDistance, distanceAfter: distanceBetween(),
                      reason: 'violent_shot_push', sourceSkillId: skillId,
                      blockedByLaneEdge: distanceBetween() < targetDistance,
                    });
                  }
                }
              }
              refundArcaneDynamo();
            } else if (action.id === 'defend') {
              self.defending = true;
              self.castLockTicks = 1;
              record({ tick, actor: 'character', action: 'defend', target: 'character' });
            } else if (action.id === 'wait') {
              self.castLockTicks = 1;
              record({ tick, actor: 'character', action: 'wait', target: 'self' });
            }
          }
          // no legal cast line -> wasted fire (§7.3 step 5)
        }
      }

      // ===== MONSTER: ATTACK GAUGE (its own gambit, §7.3) =====
      monsterAttackGauge += 1 / monsterAttackDurationTicks();
      if (monsterAttackGauge >= 1) {
        monsterAttackGauge = 0;
        const choice = GambitEvaluator.evaluateGambitPage(
          monsterGambitPage,
          'attack',
          foe,
          self,
          {},
        );

        const foeStunned = hasStatus(foe, 'stun');
        const foeDisarmed = hasStatus(foe, 'disarm');
        if (choice && choice.action.id === 'attack' && foeStunned) {
          foe.movementIntent = false;
          foe.movementIntentRange = undefined;
          record({ tick, actor: 'monster', action: 'action_suppressed', reason: 'stun', target: 'character' });
        } else if (choice && choice.action.id === 'attack' && distanceBetween() > Number(foe.basicAttackRange ?? 0)) {
          // Disarm prevents the strike, not movement needed to reach melee range.
          foe.movementIntent = true;
          foe.movementIntentRange = Number(foe.basicAttackRange ?? 0);
        } else if (choice && choice.action.id === 'attack' && foeDisarmed) {
          foe.movementIntent = false;
          foe.movementIntentRange = undefined;
          record({ tick, actor: 'monster', action: 'action_suppressed', reason: 'disarm', target: 'character' });
        } else if (choice && choice.action.id === 'attack') {
          foe.movementIntent = false;
          foe.movementIntentRange = undefined;
          const landed = rng.chance(
            BattleEngine.calculateHitChance(foe.accuracy, self.evasion) / 100,
          );
          const crit = landed && rng.chance(foe.critChance / 100);
          const monsterAttackType = foe.basicAttackDamageType ?? 'melee';
          const raw = (monsterAttackType === 'magic' ? foe.matk : effectiveAttack(foe)) * (crit ? BattleEngine.CRIT_MULTIPLIER : 1);
          let finalDamage = monsterAttackType === 'magic'
            ? BattleEngine.calculateMagicDamage(raw, self.mdefPercent)
            : BattleEngine.calculatePhysicalDamage(raw, effectiveDefense(self));
          // SPEC §8.3: defend reduces the next incoming hit by a flat 30%.
          if (self.defending) {
            finalDamage *= 1 - BattleEngine.DEFEND_DAMAGE_REDUCTION;
            self.defending = false;
          }
          const rolledDamage = landed
            ? Math.max(1, Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)))
            : 0;
          const barrierResult = absorbMagicDamage(self, monsterAttackType, rolledDamage);
          const damage = Math.max(0, barrierResult.damage);
          const distanceAtActionStart = distanceBetween();
          self.hp = Math.max(0, self.hp - damage);
          record({
            tick, actor: 'monster', action: 'attack', target: 'character',
            damage, damageAbsorbed: barrierResult.absorbed || undefined,
            damageType: monsterAttackType, crit, hit: landed, distanceAtActionStart,
          });

          const shieldBashRank = Math.max(0, Number(self.skillDefs?.shield_bash?.masteryRank ?? 0));
          if (landed && shieldBashRank > 0 && distanceAtActionStart === 0
            && foe.hp > 0 && rng.chance(Math.min(1, 0.02 * shieldBashRank))) {
            applyStatus(foe, 'stun', 'shield_bash', 5, {}, 'character');
          }
        }
      }

      // Monster cast gauge: ranged spells may define their cast time in the skill catalog.
      // Other existing monster casts retain the legacy six-tick threshold.
      const pendingMonsterCastChoice = GambitEvaluator.evaluateGambitPage(
        monsterGambitPage,
        'cast',
        foe,
        self,
        {},
      );
      const pendingMonsterSkillId = pendingMonsterCastChoice?.action?.skillId ?? pendingMonsterCastChoice?.action?.params?.skillId;
      const pendingMonsterSkillDef: any = pendingMonsterSkillId ? (monsterSkillDefs[pendingMonsterSkillId] ?? {}) : {};
      const monsterCastThreshold = pendingMonsterCastChoice?.action?.id === 'use_skill' && pendingMonsterSkillDef.ranged === true
        ? Math.max(1, Math.floor(Number(pendingMonsterSkillDef.baseCastTicks ?? BattleEngine.MONSTER_CAST_GAUGE)))
        : BattleEngine.MONSTER_CAST_GAUGE;
      // Cooldown is sequential with cast time: ticks while the last skill is
      // blocked, including the tick on which its cooldown reaches zero, do not
      // charge the next cast. For a 2-tick cast / 1-tick cooldown this yields
      // resolutions at T2, T6, T10... rather than T2, T4, T6...
      const lastMonsterCooldownKey = lastMonsterSkillId ? `skill:${lastMonsterSkillId}` : '';
      const lastMonsterSkillCooling = !!lastMonsterCooldownKey && Number(foeCooldowns[lastMonsterCooldownKey] ?? 0) > 0;
      const cooldownEndedThisTick = !!lastMonsterCooldownKey && monsterCooldownsExpiring.has(lastMonsterCooldownKey);
      if (tick > 0 && !lastMonsterSkillCooling && !cooldownEndedThisTick) monsterCastGauge += 1;
      if (monsterCastGauge >= monsterCastThreshold) {
        monsterCastGauge = 0;
        const choice = pendingMonsterCastChoice;
        const reflectionSkillId = monsterDefinition?.id === 'mon_arcanewisp' ? 'monster_skill_arcane_surge' : null;
        const reflectionSkillCost = reflectionSkillId ? Number(monsterSkillDefs[reflectionSkillId]?.spCost ?? 60) : Number.POSITIVE_INFINITY;
        if (reflectionSkillId && Number(foe.sp ?? 0) < reflectionSkillCost
          && Number(foeCooldowns[`skill:${reflectionSkillId}`] ?? 0) <= 0 && !hasStatus(foe, 'silence')) {
          applyStatus(foe, 'magic_reflection', 'monster_skill_magic_reflection', 15, { reflectPercent: 30 }, 'monster');
        }
        const monsterSelectedSkillId = choice?.action?.skillId ?? choice?.action?.params?.skillId;
        const monsterSelectedSkillDef: any = monsterSelectedSkillId ? (monsterSkillDefs[monsterSelectedSkillId] ?? {}) : {};
        // Ranged skill maxRange includes the target's space; distanceBetween() counts empty spaces.
        const monsterSkillRange = monsterSelectedSkillDef.ranged === true
          ? Math.max(0, Number(monsterSelectedSkillDef.maxRange ?? 7) - 1)
          : Math.max(0, Number(monsterSelectedSkillDef.maxRange ?? 1) - 1);
        const monsterSkillOutOfRange = choice?.action?.id === 'use_skill' && (hasStatus(foe, 'stun') || distanceBetween() > monsterSkillRange);
        if (monsterSkillOutOfRange) {
          foe.movementIntent = true;
          foe.movementIntentRange = monsterSkillRange;
        }
        if (choice && choice.action.id === 'use_skill' && !monsterSkillOutOfRange) {
          const skillId = choice.action.skillId ?? choice.action.params?.skillId;
          lastMonsterSkillId = String(skillId);
          const def: any = monsterSkillDefs[skillId] ?? {}
          foe.movementIntent = false;
          foe.movementIntentRange = undefined;
          foeCooldowns[`skill:${skillId}`] = Number(def.cooldownTicks ?? 0) + (Number(def.cooldownTicks ?? 0) > 0 ? 1 : 0);
          const spCost = Math.max(0, Number(def.spCost ?? 0));
          foe.sp = Math.max(0, foe.sp - spCost);
          const effect = def.effect ?? {};
          if (skillId === 'monster_skill_rage') {
            foe.statusEffects = (foe.statusEffects ?? []).filter((status: any) => {
              const statusId = String(status.type ?? status.id ?? '');
              return (statusEffectDefs[statusId] as any)?.polarity !== 'debuff';
            });
            applyStatus(foe, 'rage', skillId, Number(effect.durationTicks ?? 15), { atkBonus: Number(effect.atk ?? 20) }, 'monster');
            record({ tick, actor: 'monster', action: 'use_skill', skillId, target: 'monster', damage: 0, hit: true, spSpent: spCost });
          } else if (skillId === 'monster_skill_pickpocket') {
            const chance = chanceAfterSaveButtLuck(Number(effect.chance ?? 0.1), Number(self.luk ?? 0), effect.saveButtLuck === true);
            const eligible = Object.keys(inventory).filter((itemId) => {
              const definition = itemDefinitions[itemId];
              return Number(inventory[itemId] ?? 0) > 0 && definition?.type !== 'food' && definition?.effect?.type !== 'food_buff';
            }).sort();
            if (eligible.length > 0 && rng.chance(chance)) {
              const itemId = rng.pick(eligible);
              const definition = itemDefinitions[itemId] ?? {};
              const quantity = Math.min(Number(inventory[itemId] ?? 0), Math.max(1, Number(definition.maxStack ?? inventory[itemId])));
              inventory[itemId] = Math.max(0, Number(inventory[itemId] ?? 0) - quantity);
              const prior = itemsConsumed.find((item) => item.itemId === itemId);
              if (prior) prior.quantity += quantity; else itemsConsumed.push({ itemId, quantity });
              record({ tick, actor: 'monster', action: 'item_stolen', skillId, target: 'character', itemId, quantity, permanent: true, hit: true, spSpent: spCost });
            } else {
              record({ tick, actor: 'monster', action: 'pickpocket_failed', skillId, target: 'character', hit: true, spSpent: spCost });
            }
          }
          const healAmount = Number(
            effect.healAmount ?? (effect.healPercentMaxHp ? foe.maxHp * Number(effect.healPercentMaxHp) : 0),
          );
          if (skillId === 'monster_skill_pickpocket') {
            // Pickpocket resolves its own inventory event and does no direct damage.
          } else if (healAmount > 0) {
            const before = foe.hp;
            foe.hp = Math.min(foe.maxHp, foe.hp + healAmount);
            record({
              tick,
              actor: 'monster',
              action: 'use_skill',
              skillId,
              target: 'monster',
              healAmount: foe.hp - before,
            });
          } else if (skillId !== 'monster_skill_rage') {
            // Monster active skills follow the same guaranteed-hit/no-crit contract.
            const landed = true;
            const raw =
              (String(def.damageType ?? 'melee') === 'magic' ? foe.matk : effectiveAttack(foe)) *
              Number(effect.dmgMult ?? 1);
            const monsterSkillDamageType = String(def.damageType ?? 'melee');
            const finalDamage = monsterSkillDamageType === 'magic'
              ? BattleEngine.calculateMagicDamage(raw, self.mdefPercent)
              : BattleEngine.calculatePhysicalDamage(raw, effectiveDefense(self));
            const rolledDamage = landed
              ? Math.max(1, Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)))
              : 0;
            const barrierResult = absorbMagicDamage(self, monsterSkillDamageType, rolledDamage);
            const damage = Math.max(0, barrierResult.damage);
            self.hp = Math.max(0, self.hp - damage);
            record({
              tick,
              actor: 'monster',
              action: 'use_skill',
              skillId,
              target: 'character',
              damage,
              damageAbsorbed: barrierResult.absorbed || undefined,
              damageType: monsterSkillDamageType,
              hit: landed,
            });
            if (landed && effect.applyStatus && statusEffectDefs[String(effect.applyStatus)]) {
              const statusId = String(effect.applyStatus);
              const statusDef = statusEffectDefs[statusId] ?? {};
              const stackable = statusDef.stackable === true;
              const activeStatusEntries = (self.statusEffects ?? []).filter(
                (status: any) => String(status.type ?? status.id ?? '') === statusId,
              );
              const maxStacks = stackable
                ? Math.max(1, Math.floor(Number(statusDef.maxStacks ?? 1)))
                : 1;
              const canApply = stackable
                ? activeStatusEntries.length < maxStacks
                : activeStatusEntries.length === 0 || statusDef.reapplication === 'refresh';

              // Do not roll or consume RNG for a status that cannot be applied.
              if (canApply) {
                const baseStatusChance = Math.max(0, Math.min(1, Number(effect.statusChance ?? 1)));
                const statusChance = chanceAfterSaveButtLuck(baseStatusChance, Number(self.luk ?? 0), effect.saveButtLuck === true);
                // Preserve the seeded RNG stream for guaranteed status applications.
                const statusRollSucceeded = statusChance >= 1 || rng.chance(statusChance);
                if (statusRollSucceeded) {
                  if (!stackable && statusDef.reapplication === 'refresh') {
                    self.statusEffects = (self.statusEffects ?? []).filter(
                      (status: any) => String(status.type ?? status.id ?? '') !== statusId,
                    );
                  }
                  const durationTicks = Math.max(
                    1,
                    Math.floor(Number(statusDef.statusDurationTicks ?? 1)),
                  );
                  const moveSpeedPenalty = Math.max(0, Number(
                    stackable
                      ? statusDef.moveSpeedPenaltyPerStack ?? 0
                      : statusDef.moveSpeedPenalty ?? 0,
                  ));
                  const attackSpeedPenalty = Math.max(0, Number(
                    stackable
                      ? statusDef.attackSpeedPenaltyPerStack ?? 0
                      : statusDef.attackSpeedPenalty ?? 0,
                  ));
                  self.statusEffects = [...(self.statusEffects ?? []), {
                    type: statusId,
                    appliedAtTick: tick,
                    expiresAtTick: tick + (statusId === 'poison' ? Number(effect.durationTicks ?? 25) : statusId === 'bleed' ? Number(effect.durationTicks ?? 20) : durationTicks),
                    sourceSkillId: skillId,
                    sourceActor: 'monster',
                    moveSpeedPenalty,
                    attackSpeedPenalty,
                    ...(statusId === 'poison' ? { damagePerTick: Math.floor(Number(foe.matk ?? 0) * 0.5), damageIntervalTicks: Number(effect.damageIntervalTicks ?? 5), nextDamageAtTick: tick + Number(effect.damageIntervalTicks ?? 5), damageType: 'magic' } : {}),
                    ...(statusId === 'bleed' ? { damagePerTick: Number(statusDef.damagePerStack ?? 5), damageIntervalTicks: Number(statusDef.damageIntervalTicks ?? 5), nextDamageAtTick: tick + Number(statusDef.damageIntervalTicks ?? 5), damageType: 'pure' } : {}),
                  }];
                  const stackCount = (self.statusEffects ?? []).filter(
                    (status: any) => String(status.type ?? status.id ?? '') === statusId,
                  ).length;
                  const action = stackable
                    ? (statusId === 'freeze' ? 'freeze_applied' : 'status_stack_applied')
                    : 'status_applied';
                  record({
                    tick,
                    actor: 'monster',
                    action,
                    status: statusId,
                    target: 'character',
                    ...(stackable ? { stackCount } : {}),
                    expiresAtTick: tick + durationTicks,
                    durationTicks,
                    moveSpeedPenalty,
                    attackSpeedPenalty,
                    sourceSkillId: skillId,
                    statusStackable: stackable,
                  });
                }
              }
            }
          }
        }
      }

      // ===== TICK HOUSEKEEPING =====
      if ((self.attackLockTicks ?? 0) > 0) self.attackLockTicks = (self.attackLockTicks as number) - 1;
      if ((self.castLockTicks ?? 0) > 0) self.castLockTicks = (self.castLockTicks as number) - 1;
      self.foodBuffs = (self.foodBuffs ?? []).map((buff: any) => ({ ...buff, remainingTicks: Math.max(0, Number(buff.remainingTicks ?? 0) - 1) })).filter((buff: any) => buff.remainingTicks > 0);
      self.foodBuffTicksRemaining = Math.max(0, ...(self.foodBuffs ?? []).map((buff: any) => Number(buff.remainingTicks ?? 0)));
      for (const itemId of Object.keys(self.foodDigestRemainingTicksByItem ?? {})) {
        const remaining = self.foodDigestRemainingTicksByItem?.[itemId] ?? 0;
        if (remaining > 0) self.foodDigestRemainingTicksByItem![itemId] = Math.max(0, remaining - 1);
      }
      // A combatant at 0 HP is out of the fight: regen must not resurrect it
      // (otherwise a lethal hit is undone by the same tick's housekeeping).
      if (foe.hp > 0 && (tick + 1) % 10 === 0) {
        const beforeMonsterSpRegen = foe.sp;
        foe.sp = Math.min(foe.maxSp, foe.sp + Number(foe.spRegenPerTenTicks ?? 2));
        if (foe.sp > beforeMonsterSpRegen) record({ tick, actor: 'monster', action: 'sp_regen', target: 'monster', resource: 'SP', amount: foe.sp - beforeMonsterSpRegen });
      }
      if (self.hp > 0 && (regenTickOffset + tick + 1) % 10 === 0) {
        const activeFoodBuffs = (self.foodBuffs ?? []).filter((buff: any) => Number(buff.remainingTicks ?? 0) > 0);
        const foodHpRegen = activeFoodBuffs.reduce((sum: number, buff: any) => sum + Number(buff.hpRegenPerTenTicks ?? 0), 0);
        const foodSpRegen = activeFoodBuffs.reduce((sum: number, buff: any) => sum + Number(buff.spRegenPerTenTicks ?? 0), 0);
        const hpBefore = self.hp;
        const spBefore = self.sp;
        self.hp = Math.min(self.maxHp, self.hp + self.hpRegenPerTenTicks + foodHpRegen);
        self.sp = Math.min(self.maxSp, self.sp + self.spRegenPerTenTicks + foodSpRegen);
        const hpRegenerated = self.hp - hpBefore;
        const spRegenerated = self.sp - spBefore;
        if (hpRegenerated > 0) record({ tick, actor: 'character', action: 'regen', resource: 'HP', amount: hpRegenerated });
        if (spRegenerated > 0) record({ tick, actor: 'character', action: 'regen', resource: 'MP', amount: spRegenerated });
      }

      // Timed movement debuffs and deterministic post-action movement phase.
      for (const unit of [self, foe]) {
        const statuses = unit.statusEffects ?? [];
        const statusPenalty = statuses.reduce((total: number, status: any) => {
          const statusId = String(status.type ?? status.id ?? '');
          const statusDef = statusEffectDefs[statusId] ?? {};
          const penalty = Number(
            status.moveSpeedPenalty
            ?? statusDef.moveSpeedPenaltyPerStack
            ?? statusDef.moveSpeedPenalty
            ?? 0,
          );
          return total + Math.max(0, penalty);
        }, 0);
        const baseSpeed = Number(unit.moveSpeedBase ?? unit.moveSpeed ?? 0);
        unit.moveSpeed = Math.max(0, baseSpeed - statusPenalty);
      }
      refreshApproachIntent(self, foe, normalizedGambitPage, inventory, itemDefinitions);
      refreshApproachIntent(foe, self, monsterGambitPage, {}, {});
      for (const [unit, target, actor] of [[self, foe, 'character'], [foe, self, 'monster']] as Array<[CombatantSnapshot, CombatantSnapshot, string]>) {
        if (tick > 0) unit.movementGauge = Number(unit.movementGauge ?? 0) + Number(unit.moveSpeed ?? 0);
        if (!unit.movementIntent || target.hp <= 0 || hasStatus(unit, 'stun') || unit.canMove === false) { unit.movementIntent = false; continue; }
        const range = Number(unit.movementIntentRange ?? unit.basicAttackRange ?? 0);
        if (distanceBetween() <= range) { unit.movementIntent = false; unit.movementIntentRange = undefined; continue; }
        if (Number(unit.movementGauge) >= 100) {
          unit.movementGauge = Number(unit.movementGauge) - 100;
          const fromPosition = Number(unit.position ?? 0);
          const direction = Number(target.position ?? 0) > fromPosition ? 1 : -1;
          const toPosition = fromPosition + direction;
          if (toPosition >= 0 && toPosition <= 7 && toPosition !== Number(target.position)) {
            const distanceBefore = distanceBetween();
            unit.position = toPosition;
            record({ tick, actor, action: 'move', fromPosition, toPosition, spacesMoved: 1, direction: toPosition > fromPosition ? 'right' : 'left', distanceBefore, distanceAfter: distanceBetween(), moveSpeed: unit.moveSpeed, reason: 'approach_out_of_range_action' });
          }
        }
      }

      tick += 1;
    }

    const outcome: 'win' | 'loss' = foe.hp <= 0 && self.hp > 0 ? 'win' : 'loss';

    return {
      outcome,
      durationTicks: tick,
      log: {
        header: {
          monsterId: monsterDefinition?.id ?? null,
          seedUsed: seed,
          characterSnapshot: { ...characterSnapshot, position: startingPositions.character, combatStyle: startingStyles.character, basicAttackDamageType: self.basicAttackDamageType, basicAttackRange: self.basicAttackRange, moveSpeedBase: startingMoveSpeeds.character, moveSpeed: startingMoveSpeeds.character, movementGauge: 0 },
          monsterSnapshot: { ...BattleEngine.buildMonsterSnapshot(monsterDefinition), position: startingPositions.monster, combatStyle: startingStyles.monster, basicAttackDamageType: foe.basicAttackDamageType, basicAttackRange: foe.basicAttackRange, moveSpeedBase: startingMoveSpeeds.monster, moveSpeed: startingMoveSpeeds.monster, movementGauge: 0 },
        },
        events,
        finalPositions: { character: Number(self.position), monster: Number(foe.position) },
        outcome,
        durationTicks: tick,
      },
      hpAfter: self.hp,
      spAfter: self.sp,
      inventoryAfter: inventory,
      itemsConsumed,
      foodBuffAfter: (self.foodBuffs ?? []).length > 0
        ? [...(self.foodBuffs ?? [])].sort((a: any, b: any) => Number(b.remainingTicks ?? 0) - Number(a.remainingTicks ?? 0))[0]
        : undefined,
      foodBuffsAfter: (self.foodBuffs ?? []).map((buff: any) => ({ ...buff })),
    };
  }
}

export default BattleEngine;

export { projectStatusTimeline } from './status-timeline';
export type { ProjectedStatusStack } from './status-timeline';
