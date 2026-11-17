export enum Attribute {
  STR = 'str',
  AGI = 'agi',
  DEX = 'dex',
  VIT = 'vit',
  INT = 'int',
  LUK = 'luk',
}

export enum WeaponType {
  SWORD = 'sword',
  GREATSWORD = 'greatsword',
  DAGGER = 'dagger',
  BOW = 'bow',
  STAFF = 'staff',
  ROD = 'rod',
  SHIELD = 'shield',
  RUNE = 'rune',
}

/** Current Mastery categories. Shield and Rune are defensive equipment categories. */
export enum MasteryCategory {
  SWORD = 'sword',
  GREATSWORD = 'greatsword',
  DAGGER = 'dagger',
  BOW = 'bow',
  STAFF = 'staff',
  ROD = 'rod',
  SHIELD = 'shield',
  RUNE = 'rune',
}

export enum EquipmentSlot {
  HEAD = 'head',
  BODY = 'body',
  MAIN_HAND = 'mainHand',
  OFF_HAND = 'offHand',
  SHOES = 'shoes',
  CAPE = 'cape',
  ACCESSORY_LEFT = 'accessoryLeft',
  ACCESSORY_RIGHT = 'accessoryRight',
}

export enum DamageType {
  MELEE = 'melee',
  RANGED = 'ranged',
  MAGIC = 'magic',
}

export enum CharacterStatus {
  TOWN = 'town',
  GRINDING = 'grinding',
  DEAD_PENDING_RETURN = 'dead_pending_return',
}

export enum InventoryLocation {
  INVENTORY = 'inventory',
  WAREHOUSE = 'warehouse',
}

export enum MarketOrderType {
  SELL = 'sell',
  BUY = 'buy',
}

export enum MarketOrderStatus {
  ACTIVE = 'active',
  FULFILLED = 'fulfilled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum BattleOutcome {
  WIN = 'win',
  LOSS = 'loss',
}

export enum GambitConditionId {
  SELF_HAS_STATUS = 'self_has_status',
  SELF_MISSING_STATUS = 'self_missing_status',
  SELF_HP = 'self_hp',
  SELF_SP = 'self_sp',
  ALLY_HAS_STATUS = 'ally_has_status',
  ALLY_MISSING_STATUS = 'ally_missing_status',
  ALLY_HP = 'ally_hp',
  ALLY_SP = 'ally_sp',
  ALLY_TARGETED_BY_FOE = 'ally_targeted_by_foe',
  ALLY_TARGETED_BY_ALLY = 'ally_targeted_by_ally',
  ALLY_LOWEST_HP = 'ally_lowest_hp',
  ALLY_LOWEST_DEF = 'ally_lowest_def',
  ALLY_LOWEST_MDEF = 'ally_lowest_mdef',
  FOE_HAS_STATUS = 'foe_has_status',
  FOE_MISSING_STATUS = 'foe_missing_status',
  FOE_HP = 'foe_hp',
  FOE_SP = 'foe_sp',
  FOE_ELEMENT_WEAK = 'foe_element_weak',
  FOE_PARTY_LEADER_TARGET = 'foe_party_leader_target',
  FOE_TARGETING_LEADER = 'foe_targeting_leader',
  FOE_TARGETING_SELF = 'foe_targeting_self',
  FOE_NOT_TARGETED_BY_ALLY = 'foe_not_targeted_by_ally',
  FOE_HIGHEST_HP = 'foe_highest_hp',
  FOE_HIGHEST_MP = 'foe_highest_mp',
  FOE_HIGHEST_MATK = 'foe_highest_matk',
  FOE_HIGHEST_DEFENSE = 'foe_highest_defense',
  FOE_LOWEST_HP = 'foe_lowest_hp',
  FOE_LOWEST_MP = 'foe_lowest_mp',
  FOE_LOWEST_MATK = 'foe_lowest_matk',
  FOE_HIGHEST_MDEF = 'foe_highest_mdef',
  FOE_HIGHEST_MAX_HP = 'foe_highest_max_hp',
  FOE_HIGHEST_MAX_MP = 'foe_highest_max_mp',
  FOE_HIGHEST_SPEED = 'foe_highest_speed',
  FOE_LOWEST_MAX_HP = 'foe_lowest_max_hp',
  FOE_LOWEST_MAX_MP = 'foe_lowest_max_mp',
  FOE_LOWEST_SPEED = 'foe_lowest_speed',
  FOE_FURTHEST = 'foe_furthest',
  FOE_NEAREST = 'foe_nearest',
  ALWAYS = 'always',
}
export enum GambitActionId {
  ATTACK = 'attack',
  USE_SKILL = 'use_skill',
  USE_ITEM = 'use_item',
}
