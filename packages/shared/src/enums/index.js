"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GambitActionId = exports.GambitConditionId = exports.HP_BAND_RANGES = exports.HPBand = exports.BattleOutcome = exports.MarketOrderStatus = exports.MarketOrderType = exports.InventoryLocation = exports.CharacterStatus = exports.DamageType = exports.EquipmentSlot = exports.WeaponType = exports.Attribute = void 0;
var Attribute;
(function (Attribute) {
    Attribute["STR"] = "str";
    Attribute["AGI"] = "agi";
    Attribute["DEX"] = "dex";
    Attribute["VIT"] = "vit";
    Attribute["INT"] = "int";
    Attribute["SOR"] = "sor";
})(Attribute || (exports.Attribute = Attribute = {}));
var WeaponType;
(function (WeaponType) {
    WeaponType["SWORD"] = "sword";
    WeaponType["GREATSWORD"] = "greatsword";
    WeaponType["DAGGER"] = "dagger";
    WeaponType["BOW"] = "bow";
    WeaponType["STAFF"] = "staff";
    WeaponType["WAND"] = "wand";
    WeaponType["SHIELD"] = "shield";
})(WeaponType || (exports.WeaponType = WeaponType = {}));
var EquipmentSlot;
(function (EquipmentSlot) {
    EquipmentSlot["HEAD"] = "head";
    EquipmentSlot["BODY"] = "body";
    EquipmentSlot["MAIN_HAND"] = "mainHand";
    EquipmentSlot["OFF_HAND"] = "offHand";
    EquipmentSlot["SHOES"] = "shoes";
    EquipmentSlot["CAPE"] = "cape";
    EquipmentSlot["ACCESSORY_LEFT"] = "accessoryLeft";
    EquipmentSlot["ACCESSORY_RIGHT"] = "accessoryRight";
})(EquipmentSlot || (exports.EquipmentSlot = EquipmentSlot = {}));
var DamageType;
(function (DamageType) {
    DamageType["MELEE"] = "melee";
    DamageType["RANGED"] = "ranged";
    DamageType["MAGIC"] = "magic";
})(DamageType || (exports.DamageType = DamageType = {}));
var CharacterStatus;
(function (CharacterStatus) {
    CharacterStatus["TOWN"] = "town";
    CharacterStatus["GRINDING"] = "grinding";
    CharacterStatus["DEAD_PENDING_RETURN"] = "dead_pending_return";
})(CharacterStatus || (exports.CharacterStatus = CharacterStatus = {}));
var InventoryLocation;
(function (InventoryLocation) {
    InventoryLocation["INVENTORY"] = "inventory";
    InventoryLocation["WAREHOUSE"] = "warehouse";
})(InventoryLocation || (exports.InventoryLocation = InventoryLocation = {}));
var MarketOrderType;
(function (MarketOrderType) {
    MarketOrderType["SELL"] = "sell";
    MarketOrderType["BUY"] = "buy";
})(MarketOrderType || (exports.MarketOrderType = MarketOrderType = {}));
var MarketOrderStatus;
(function (MarketOrderStatus) {
    MarketOrderStatus["ACTIVE"] = "active";
    MarketOrderStatus["FULFILLED"] = "fulfilled";
    MarketOrderStatus["CANCELLED"] = "cancelled";
    MarketOrderStatus["EXPIRED"] = "expired";
})(MarketOrderStatus || (exports.MarketOrderStatus = MarketOrderStatus = {}));
var BattleOutcome;
(function (BattleOutcome) {
    BattleOutcome["WIN"] = "win";
    BattleOutcome["LOSS"] = "loss";
})(BattleOutcome || (exports.BattleOutcome = BattleOutcome = {}));
var HPBand;
(function (HPBand) {
    HPBand["FULL"] = "FULL";
    HPBand["HIGH"] = "HIGH";
    HPBand["MEDIUM"] = "MEDIUM";
    HPBand["LOW"] = "LOW";
    HPBand["CRITICAL"] = "CRITICAL";
})(HPBand || (exports.HPBand = HPBand = {}));
exports.HP_BAND_RANGES = {
    [HPBand.FULL]: [100, 100],
    [HPBand.HIGH]: [70, 99],
    [HPBand.MEDIUM]: [30, 69],
    [HPBand.LOW]: [10, 29],
    [HPBand.CRITICAL]: [1, 9],
};
var GambitConditionId;
(function (GambitConditionId) {
    GambitConditionId["ALWAYS"] = "always";
    GambitConditionId["SELF_HP_BAND"] = "self_hp_band";
    GambitConditionId["SELF_SP_BAND"] = "self_sp_band";
    GambitConditionId["FOE_HP_BAND"] = "foe_hp_band";
    GambitConditionId["SELF_HAS_STATUS"] = "self_has_status";
    GambitConditionId["SELF_MISSING_STATUS"] = "self_missing_status";
    GambitConditionId["FOE_HAS_STATUS"] = "foe_has_status";
    GambitConditionId["SELF_HUNGRY"] = "self_hungry";
    GambitConditionId["FOE_ELEMENT_IS"] = "foe_element_is";
    GambitConditionId["SKILL_READY"] = "skill_ready";
    GambitConditionId["ITEM_IN_STOCK"] = "item_in_stock";
})(GambitConditionId || (exports.GambitConditionId = GambitConditionId = {}));
var GambitActionId;
(function (GambitActionId) {
    GambitActionId["ATTACK"] = "attack";
    GambitActionId["USE_SKILL"] = "use_skill";
    GambitActionId["USE_ITEM"] = "use_item";
    GambitActionId["DEFEND"] = "defend";
    GambitActionId["WAIT"] = "wait";
})(GambitActionId || (exports.GambitActionId = GambitActionId = {}));
