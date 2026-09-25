export enum Attribute {
  STR = 'str',
  AGI = 'agi',
  DEX = 'dex',
  VIT = 'vit',
  INT = 'int',
  SOR = 'sor',
}

export enum WeaponType {
  SWORD = 'sword',
  GREATSWORD = 'greatsword',
  DAGGER = 'dagger',
  BOW = 'bow',
  STAFF = 'staff',
  WAND = 'wand',
  SHIELD = 'shield',
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

export enum HPBand {
  FULL = 'FULL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  CRITICAL = 'CRITICAL',
}

export const HP_BAND_RANGES: Record<HPBand, [number, number]> = {
  [HPBand.FULL]: [100, 100],
  [HPBand.HIGH]: [70, 99],
  [HPBand.MEDIUM]: [30, 69],
  [HPBand.LOW]: [10, 29],
  [HPBand.CRITICAL]: [1, 9],
};

export enum GambitConditionId {
  ALWAYS = 'always',
  SELF_HP_BAND = 'self_hp_band',
  SELF_SP_BAND = 'self_sp_band',
  FOE_HP_BAND = 'foe_hp_band',
  SELF_HAS_STATUS = 'self_has_status',
  SELF_MISSING_STATUS = 'self_missing_status',
  FOE_HAS_STATUS = 'foe_has_status',
  SELF_HUNGRY = 'self_hungry',
  FOE_ELEMENT_IS = 'foe_element_is',
  SKILL_READY = 'skill_ready',
  ITEM_IN_STOCK = 'item_in_stock',
}

export enum GambitActionId {
  ATTACK = 'attack',
  USE_SKILL = 'use_skill',
  USE_ITEM = 'use_item',
  DEFEND = 'defend',
  WAIT = 'wait',
}
