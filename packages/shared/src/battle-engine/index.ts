import { Mulberry32 } from './prng';

export {
  Mulberry32,
  mulberry32Seed,
  rngForIndex,
} from './prng';
export * from './rewards';

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
  /** Raw attributes, needed for the gauge thresholds in SPEC §7.2 */
  agi: number;
  dex: number;
  /** Skills currently usable (unlocked + weapon equipped) - SPEC §9.1 */
  skills?: Record<string, any>;
  /** Skill defs, needed for spCost/baseCastTicks/cooldownTicks - SPEC §9 */
  skillDefs?: Record<string, any>;
  statusEffects?: any[];
  /** Remaining ticks on the active food buff. 0/undefined = hungry. */
  foodBuffTicksRemaining?: number;
  foodBuffItemId?: string;
  foodBuffHpRegenPerTenTicks?: number;
  foodBuffSpRegenPerTenTicks?: number;
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
  ): boolean {
    const id = action?.id;
    const params = GambitEvaluator.readParams(action);
    const cooldowns = self.cooldowns ?? {};

    switch (id) {
      case 'attack':
        return self.hp > 0 && self.maxHp > 0;

      case 'use_skill': {
        const skillId = params.skillId;
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
      if (!GambitEvaluator.isActionLegal(action, self, inventory)) continue;

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
  static readonly MONSTER_CAST_GAUGE = 6;
  static readonly DEFEND_DAMAGE_REDUCTION = 0.3;
  /** Safety valve so a stalemate can't hang the queue (SPEC §7.1 is tick-indexed). */
  static readonly MAX_TICKS = 200;

  /**
   * Calculate derived stats from base attributes and equipment (SPEC §5)
   */
  static calculateDerivedStats(level: number, attributes: Record<string, number>, equipment: any) {
    const str = Number(attributes['str'] ?? 5);
    const agi = Number(attributes['agi'] ?? 5);
    const dex = Number(attributes['dex'] ?? 5);
    const vit = Number(attributes['vit'] ?? 5);
    const int = Number(attributes['int'] ?? 5);
    const sor = Number(attributes['sor'] ?? 5);
    const maxHp = Math.floor(50 + vit * 18 + Number(equipment?.maxHp ?? 0));
    const maxSp = Math.floor(20 + int * 8 + Number(equipment?.maxSp ?? 0));
    const atk = Math.floor(str * 2 + Number(equipment?.weaponFixedAtk ?? 0));
    const matk = Math.floor(int * 2 + Number(equipment?.weaponFixedMatk ?? 0));
    const def = Math.floor(Number(equipment?.def ?? 0));
    const mdefPercent = Math.min(100, Math.max(0, Number(equipment?.mdefPercent ?? 0)));
    const attackSpeed = 100 + Math.floor(agi * 2);
    const castSpeed = 100 + Math.floor(dex * 2);
    const evasion = Math.floor(agi * 1.5);
    const accuracy = 50 + Math.floor(dex * 2);
    const hpRegenPerTenTicks = 1 + Math.floor(vit / 2);
    const spRegenPerTenTicks = 1 + Math.floor(int / 2);
    const critChance = 1 + Math.floor(sor * 0.3 * 10) / 10;
    return { maxHp, maxSp, atk, matk, def, mdefPercent, accuracy, evasion, critChance,
      attackSpeed, castSpeed, hpRegenPerTenTicks, spRegenPerTenTicks, agi, dex, level };
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
      sp: 0,
      maxHp: Number(monsterDefinition?.hp ?? 1),
      maxSp: 0,
      atk: Number(monsterDefinition?.atk ?? 1),
      matk: Number(monsterDefinition?.matk ?? 1),
      def: Number(monsterDefinition?.def ?? 0),
      mdefPercent: Number(monsterDefinition?.mdefPercent ?? 0),
      accuracy: Number(monsterDefinition?.accuracy ?? 50),
      evasion: Number(monsterDefinition?.evasion ?? 0),
      critChance: Number(monsterDefinition?.critChance ?? 1),
      hpRegenPerTenTicks: 0,
      spRegenPerTenTicks: 0,
      agi: Number(monsterDefinition?.agi ?? 0),
      dex: Number(monsterDefinition?.dex ?? 0),
      statusEffects: [],
      element: monsterDefinition?.element ?? null,
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
    return Math.max(5, Math.min(95, 75 + (accuracy - evasion) * 0.5));
  }

  /**
   * SPEC §7.2: attackGaugeThreshold = weaponBaseAttackTicks - floor(AGI * 0.04), min 2
   */
  static attackGaugeThreshold(weaponBaseAttackTicks: number, agi: number): number {
    return Math.max(
      BattleEngine.MIN_ATTACK_GAUGE,
      Math.floor(weaponBaseAttackTicks) - Math.floor(agi * 0.04),
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
   * @param options.weaponBaseAttackTicks from skill_trees.json for the equipped weapon
   */
  static simulateBattle(
    characterSnapshot: CombatantSnapshot,
    monsterDefinition: any,
    gambitPage: any,
    seed: string,
    options: {
      inventory?: Record<string, number>;
      weaponBaseAttackTicks?: number;
      itemDefinitions?: Record<string, any>;
      monsterSkillDefs?: Record<string, any>;
      maxTicks?: number;
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
  } {
    const rng = new Mulberry32(seed);
    const inventory: Record<string, number> = { ...(options.inventory ?? {}) };
    const itemDefinitions: Record<string, any> = options.itemDefinitions ?? {};
    const maxTicks = options.maxTicks ?? BattleEngine.MAX_TICKS;
    const regenTickOffset = Math.max(0, Math.floor(options.regenTickOffset ?? 0));

    // Monsters follow the exact same engine using their own gambit array (§7.3)
    const normalizedGambitPage = GambitEvaluator.normalizeGambitPage(gambitPage);
    const monsterGambitPage = GambitEvaluator.normalizeGambitPage(monsterDefinition?.gambit);
    const monsterSkillDefs: Record<string, any> = options.monsterSkillDefs ?? {};

    const cooldowns: Record<string, number> = {};

    const self: CombatantSnapshot = {
      ...characterSnapshot,
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
      foodDigestRemainingTicksByItem: { ...(characterSnapshot.foodDigestRemainingTicksByItem ?? {}) },
    };

    const foeCooldowns: Record<string, number> = {};

    const foe: CombatantSnapshot = {
      ...BattleEngine.buildMonsterSnapshot(monsterDefinition),
      cooldowns: foeCooldowns,
      statusEffects: [],
      // Monster skills are all available to the monster; its own gambit decides
      // when to use one. Character skill *unlocking* (§9.1) does not apply here.
      skills: monsterSkillDefs,
      skillDefs: monsterSkillDefs,
    };

    const events: any[] = [];
    const itemsConsumed: Array<{ itemId: string; quantity: number }> = [];

    let attackGauge = 0;
    let castGauge = 0;
    let monsterAttackGauge = 0;
    let monsterCastGauge = 0;
    let tick = 0;

    const weaponBaseAttackTicks = options.weaponBaseAttackTicks ?? 6;
    // SPEC §7.2 thresholds are driven by AGI / DEX, which the API folds into
    // the snapshot alongside the already-derived combat stats.
    const selfAttackThreshold = BattleEngine.attackGaugeThreshold(
      weaponBaseAttackTicks,
      self.agi,
    );
    const selfCastThreshold = BattleEngine.castGaugeThreshold(self.dex);
    const monsterAttackThreshold = Math.max(
      BattleEngine.MIN_ATTACK_GAUGE,
      Number(monsterDefinition?.atkSpeedTicks ?? 6),
    );

    const damageTakenMultiplier = monsterDefinition?.damageTakenMultiplier ?? {};
    const meleeMult = Number(damageTakenMultiplier.melee ?? 1);
    const rangedMult = Number(damageTakenMultiplier.ranged ?? 1);
    const magicMult = Number(damageTakenMultiplier.magic ?? 1);

    const record = (event: any) => {
      events.push({
        ...event,
        hpRemaining: { character: self.hp, monster: foe.hp },
        spRemaining: { character: self.sp },
      });
    };

    while (
      tick < maxTicks &&
      self.hp > 0 &&
      foe.hp > 0
    ) {
      // Conditions like `every_n_ticks` are tick-indexed (SPEC §7.1)
      self.tick = tick;
      foe.tick = tick;
      BattleEngine.tickCooldowns(cooldowns);
      BattleEngine.tickCooldowns(foeCooldowns);

      // ===== CHARACTER: ATTACK GAUGE =====
      // SPEC §7.2: while that gauge's action is resolving, the gauge is locked
      // at zero and refilling restarts once the action resolves.
      if ((self.attackLockTicks ?? 0) <= 0) {
        attackGauge += 1;
        if (attackGauge >= selfAttackThreshold) {
          attackGauge = 0;
          const choice = GambitEvaluator.evaluateGambitPage(
            normalizedGambitPage,
            'attack',
            self,
            foe,
            inventory,
          );

          if (choice && choice.action.id === 'attack') {
            const hitChance = BattleEngine.calculateHitChance(self.accuracy, foe.evasion);
            const landed = rng.chance(hitChance / 100);
            const crit = landed && rng.chance(self.critChance / 100);
            const baseDamage = self.atk * (crit ? BattleEngine.CRIT_MULTIPLIER : 1);
            const mitigation = BattleEngine.calculatePhysicalDamage(baseDamage, foe.def);
            const finalDamage = mitigation * meleeMult;
            const damage = landed
              ? Math.max(1, Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)))
              : 0;
            foe.hp = Math.max(0, foe.hp - damage);

            record({
              tick,
              actor: 'character',
              action: 'attack',
              target: 'monster',
              damage,
              damageType: 'melee',
              crit,
              hit: landed,
            });
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
          const choice = GambitEvaluator.evaluateGambitPage(
            normalizedGambitPage,
            'cast',
            self,
            foe,
            inventory,
          );

          if (choice) {
            const action = choice.action;
            const params = (action as any);

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
                self.foodBuffTicksRemaining = Number(def.effect?.durationSeconds ?? 0);
                self.foodDigestRemainingTicksByItem = {
                  ...(self.foodDigestRemainingTicksByItem ?? {}),
                  [itemId]: self.foodBuffTicksRemaining,
                };
                self.foodBuffItemId = itemId;
                const dietLevels = self.dietLevelByFood ?? {};
                const hasConsumedBefore = Object.prototype.hasOwnProperty.call(dietLevels, itemId);
                const currentDietLevel = Math.max(0, Math.min(3, Number(dietLevels[itemId] ?? 0)));
                const nextDietLevel = hasConsumedBefore ? Math.min(3, currentDietLevel + 1) : 0;
                self.dietLevelByFood = { ...dietLevels, [itemId]: nextDietLevel };
                self.foodBuffHpRegenPerTenTicks = effectiveFoodStatValue(def.effect?.hpRegenPerTenTicks, nextDietLevel);
                self.foodBuffSpRegenPerTenTicks = effectiveFoodStatValue(def.effect?.spRegenPerTenTicks, nextDietLevel);
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
              const spCost = Number(def.spCost ?? 0);
              self.sp = Math.max(0, self.sp - spCost);
              cooldowns[`skill:${skillId}`] = Number(def.cooldownTicks ?? 0);
              self.castLockTicks = Number(def.baseCastTicks ?? 2);

              const effect = def.effect ?? {};
              const mult = Number(effect.dmgMult ?? 1);
              const isMagic = String(def.damageType ?? 'melee') === 'magic';
              const archetypeMult = isMagic
                ? magicMult
                : rangedMult;
              const landed = rng.chance(
                BattleEngine.calculateHitChance(self.accuracy, foe.evasion) / 100,
              );
              const crit = landed && rng.chance(self.critChance / 100);
              const raw = (isMagic ? self.matk : self.atk) * mult * (crit ? BattleEngine.CRIT_MULTIPLIER : 1);
              const finalDamage = (isMagic
                ? BattleEngine.calculateMagicDamage(raw, foe.mdefPercent)
                : BattleEngine.calculatePhysicalDamage(raw, foe.def)) * archetypeMult;
              const damage = landed
                ? Math.max(
                    1,
                    Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)),
                  )
                : 0;
              foe.hp = Math.max(0, foe.hp - damage);

              record({
                tick,
                actor: 'character',
                action: 'use_skill',
                skillId,
                target: 'monster',
                damage,
                damageType: String(def.damageType ?? 'melee'),
                crit,
                hit: landed,
                spSpent: spCost,
              });
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
      monsterAttackGauge += 1;
      if (monsterAttackGauge >= monsterAttackThreshold) {
        monsterAttackGauge = 0;
        const choice = GambitEvaluator.evaluateGambitPage(
          monsterGambitPage,
          'attack',
          foe,
          self,
          {},
        );

        if (choice && choice.action.id === 'attack') {
          const landed = rng.chance(
            BattleEngine.calculateHitChance(foe.accuracy, self.evasion) / 100,
          );
          const crit = landed && rng.chance(foe.critChance / 100);
          const raw = foe.atk * (crit ? BattleEngine.CRIT_MULTIPLIER : 1);
          let finalDamage = BattleEngine.calculatePhysicalDamage(raw, self.def);
          // SPEC §8.3: defend reduces the next incoming hit by a flat 30%.
          // This is a final damage modifier, so variance is applied after it.
          if (self.defending) {
            finalDamage *= 1 - BattleEngine.DEFEND_DAMAGE_REDUCTION;
            self.defending = false;
          }
          const damage = landed
            ? Math.max(1, Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)))
            : 0;
          self.hp = Math.max(0, self.hp - damage);
          record({
            tick,
            actor: 'monster',
            action: 'attack',
            target: 'character',
            damage,
            damageType: 'melee',
            crit,
            hit: landed,
          });
        }
      }

      // ===== MONSTER: CAST GAUGE (flat threshold 6, §7.2) =====
      monsterCastGauge += 1;
      if (monsterCastGauge >= BattleEngine.MONSTER_CAST_GAUGE) {
        monsterCastGauge = 0;
        const choice = GambitEvaluator.evaluateGambitPage(
          monsterGambitPage,
          'cast',
          foe,
          self,
          {},
        );
        if (choice && choice.action.id === 'use_skill') {
          const skillId = choice.action.skillId ?? choice.action.params?.skillId;
          const def: any = monsterSkillDefs[skillId] ?? {};
          foeCooldowns[`skill:${skillId}`] = Number(def.cooldownTicks ?? 0);
          const effect = def.effect ?? {};
          const healAmount = Number(
            effect.healAmount ?? (effect.healPercentMaxHp ? foe.maxHp * Number(effect.healPercentMaxHp) : 0),
          );
          if (healAmount > 0) {
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
          } else {
            const landed = rng.chance(
              BattleEngine.calculateHitChance(foe.accuracy, self.evasion) / 100,
            );
            const raw =
              (String(def.damageType ?? 'melee') === 'magic' ? foe.matk : foe.atk) *
              Number(effect.dmgMult ?? 1);
            const finalDamage = BattleEngine.calculatePhysicalDamage(raw, self.def);
            const damage = landed
              ? Math.max(1, Math.floor(BattleEngine.applyDirectDamageVariance(finalDamage, rng)))
              : 0;
            self.hp = Math.max(0, self.hp - damage);
            record({
              tick,
              actor: 'monster',
              action: 'use_skill',
              skillId,
              target: 'character',
              damage,
              damageType: String(def.damageType ?? 'melee'),
              hit: landed,
            });
          }
        }
      }

      // ===== TICK HOUSEKEEPING =====
      if ((self.attackLockTicks ?? 0) > 0) self.attackLockTicks = (self.attackLockTicks as number) - 1;
      if ((self.castLockTicks ?? 0) > 0) self.castLockTicks = (self.castLockTicks as number) - 1;
      if ((self.foodBuffTicksRemaining ?? 0) > 0) self.foodBuffTicksRemaining = Math.max(0, (self.foodBuffTicksRemaining as number) - 1);
      for (const itemId of Object.keys(self.foodDigestRemainingTicksByItem ?? {})) {
        const remaining = self.foodDigestRemainingTicksByItem?.[itemId] ?? 0;
        if (remaining > 0) self.foodDigestRemainingTicksByItem![itemId] = Math.max(0, remaining - 1);
      }
      // A combatant at 0 HP is out of the fight: regen must not resurrect it
      // (otherwise a lethal hit is undone by the same tick's housekeeping).
      if (self.hp > 0 && (regenTickOffset + tick + 1) % 10 === 0) {
        const foodHpRegen = (self.foodBuffTicksRemaining ?? 0) > 0 ? Number(self.foodBuffHpRegenPerTenTicks ?? 0) : 0;
        const foodSpRegen = (self.foodBuffTicksRemaining ?? 0) > 0 ? Number(self.foodBuffSpRegenPerTenTicks ?? 0) : 0;
        const hpBefore = self.hp;
        const spBefore = self.sp;
        self.hp = Math.min(self.maxHp, self.hp + self.hpRegenPerTenTicks + foodHpRegen);
        self.sp = Math.min(self.maxSp, self.sp + self.spRegenPerTenTicks + foodSpRegen);
        const hpRegenerated = self.hp - hpBefore;
        const spRegenerated = self.sp - spBefore;
        if (hpRegenerated > 0) record({ tick, actor: 'character', action: 'regen', resource: 'HP', amount: hpRegenerated });
        if (spRegenerated > 0) record({ tick, actor: 'character', action: 'regen', resource: 'MP', amount: spRegenerated });
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
          characterSnapshot: characterSnapshot,
          monsterSnapshot: BattleEngine.buildMonsterSnapshot(monsterDefinition),
        },
        events,
        outcome,
        durationTicks: tick,
      },
      hpAfter: self.hp,
      spAfter: self.sp,
      inventoryAfter: inventory,
      itemsConsumed,
      foodBuffAfter: (self.foodBuffTicksRemaining ?? 0) > 0 && self.foodBuffItemId
        ? {
            itemId: self.foodBuffItemId,
            hpRegenPerTenTicks: Number(self.foodBuffHpRegenPerTenTicks ?? 0),
            spRegenPerTenTicks: Number(self.foodBuffSpRegenPerTenTicks ?? 0),
            remainingTicks: self.foodBuffTicksRemaining ?? 0,
          }
        : undefined,
    };
  }
}

export default BattleEngine;
