"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EquipmentService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const equipped_item_entity_1 = require("../../database/entities/equipped-item.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const weapon_proficiency_entity_1 = require("../../database/entities/weapon-proficiency.entity");
const data_service_1 = require("../data/data.service");
let EquipmentService = class EquipmentService {
    equippedItemRepo;
    characterRepo;
    weaponProfRepo;
    dataService;
    logger = new common_1.Logger('EquipmentService');
    constructor(equippedItemRepo, characterRepo, weaponProfRepo, dataService) {
        this.equippedItemRepo = equippedItemRepo;
        this.characterRepo = characterRepo;
        this.weaponProfRepo = weaponProfRepo;
        this.dataService = dataService;
    }
    /**
     * Get all equipped items for a character
     */
    async getEquipment(characterId) {
        return this.equippedItemRepo.find({
            where: { characterId },
        });
    }
    /**
     * Get item equipped in a specific slot
     */
    async getEquippedInSlot(characterId, slot) {
        return this.equippedItemRepo.findOne({
            where: { characterId, slot },
        });
    }
    /**
     * Calculate total equipment stats (DEF, MDEF%, attribute bonuses)
     * Used in character stats calculation
     */
    async calculateEquipmentStats(characterId) {
        const equipped = await this.getEquipment(characterId);
        const stats = {
            def: 0,
            mdefPercent: 0,
            statBonus: {
                STR: 0,
                AGI: 0,
                DEX: 0,
                VIT: 0,
                INT: 0,
                SOR: 0,
            },
        };
        for (const equip of equipped) {
            const itemDef = this.dataService.getItemById(equip.itemId);
            if (!itemDef || itemDef.type !== 'equipment')
                continue;
            // Add fixed stats
            if (itemDef.fixedStats?.def) {
                stats.def += itemDef.fixedStats.def;
            }
            if (itemDef.fixedStats?.mdefPercent) {
                stats.mdefPercent += itemDef.fixedStats.mdefPercent;
            }
            // Add stat bonuses from fixed stats
            if (itemDef.fixedStats?.statBonus) {
                const statBonusObj = itemDef.fixedStats.statBonus;
                for (const [attr, bonus] of Object.entries(statBonusObj)) {
                    const attrKey = attr;
                    if (attrKey in stats.statBonus && typeof bonus === 'number') {
                        stats.statBonus[attrKey] = (stats.statBonus[attrKey] || 0) + bonus;
                    }
                }
            }
            // Add random roll bonus if present
            if (equip.instanceData?.rolledAttribute && equip.instanceData?.rolledValue) {
                const attr = equip.instanceData.rolledAttribute;
                if (stats.statBonus[attr] !== undefined) {
                    stats.statBonus[attr] += equip.instanceData.rolledValue;
                }
            }
            // Add weapon fixed attack values
            if (equip.slot === 'mainHand' && itemDef.fixedStats?.atk) {
                stats.weaponFixedAtk = (stats.weaponFixedAtk || 0) + itemDef.fixedStats.atk;
            }
            // TODO: Add magic attack from weapons if applicable
            // if (itemDef.fixedStats?.matk) {
            //   stats.weaponFixedMatk = (stats.weaponFixedMatk || 0) + itemDef.fixedStats.matk;
            // }
        }
        // Clamp MDEF% to 0-100 range
        stats.mdefPercent = Math.min(100, Math.max(0, stats.mdefPercent));
        return stats;
    }
    /**
     * Calculate derived stats for a character with current equipment
     */
    async calculateDerivedStats(character) {
        const equipStats = await this.calculateEquipmentStats(character.id);
        // Add equipment bonuses to base attributes
        const effectiveStr = character.str + (equipStats.statBonus.STR || 0);
        const effectiveAgi = character.agi + (equipStats.statBonus.AGI || 0);
        const effectiveDex = character.dex + (equipStats.statBonus.DEX || 0);
        const effectiveVit = character.vit + (equipStats.statBonus.VIT || 0);
        const effectiveInt = character.int + (equipStats.statBonus.INT || 0);
        const effectiveSor = character.sor + (equipStats.statBonus.SOR || 0);
        // Calculate derived stats per SPEC §5.2
        const maxHp = Math.floor(80 + effectiveVit * 12 + character.level * 18);
        const maxSp = Math.floor(40 + effectiveInt * 10 + character.level * 8);
        const atk = Math.floor(effectiveStr * 2.2 +
            effectiveDex * 0.5 +
            (equipStats.weaponFixedAtk || 0));
        const matk = Math.floor(effectiveInt * 2.5 +
            effectiveDex * 0.3 +
            (equipStats.weaponFixedMatk || 0));
        const def = equipStats.def;
        const mdefPercent = equipStats.mdefPercent;
        const accuracy = Math.floor(75 + effectiveDex * 1.0 + character.level * 1.0);
        const evasion = Math.floor(effectiveAgi * 0.8);
        const critChance = Math.max(1, Math.min(50, Math.floor(1 + effectiveSor * 0.3)));
        const hpRegenPerTick = Math.floor(1 + Math.floor(effectiveVit * 0.5) + Math.floor(maxHp * 0.005));
        const spRegenPerTick = Math.floor(1 + Math.floor(effectiveInt * 0.5) + Math.floor(maxSp * 0.01));
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
     * Equip an item in a slot
     * Validates compatibility and triggers battle queue invalidation
     */
    async equipItem(characterId, slot, itemId) {
        const character = await this.characterRepo.findOne({
            where: { id: characterId },
        });
        if (!character)
            throw new common_1.NotFoundException('Character not found');
        const itemDef = this.dataService.getItemById(itemId);
        if (!itemDef || itemDef.type !== 'equipment') {
            throw new common_1.BadRequestException('Item is not equipment');
        }
        if (itemDef.slot !== slot) {
            throw new common_1.BadRequestException(`Item ${itemId} cannot be equipped in slot ${slot}`);
        }
        if (character.level < (itemDef.levelReq || 1)) {
            throw new common_1.BadRequestException(`Character level ${character.level} is below requirement ${itemDef.levelReq}`);
        }
        // Validate weapon combinations if equipping a weapon
        if (slot === 'mainHand' || slot === 'offHand') {
            const validation = await this.validateWeaponCombination(characterId, slot === 'mainHand' ? itemId : undefined, slot === 'offHand' ? itemId : undefined);
            if (!validation.valid) {
                throw new common_1.BadRequestException(`Weapon combination invalid: ${validation.errors?.join(', ')}`);
            }
        }
        // Upsert equipped item
        let equipped = await this.getEquippedInSlot(characterId, slot);
        if (equipped) {
            equipped.itemId = itemId;
            equipped.instanceData = null;
        }
        else {
            equipped = this.equippedItemRepo.create({
                characterId,
                slot,
                itemId,
            });
        }
        await this.equippedItemRepo.save(equipped);
        // TODO: Invalidate battle queue (call BattleService.invalidateQueue)
        this.logger.debug(`Character ${characterId} equipped ${itemId} in slot ${slot}`);
        return equipped;
    }
    /**
     * Unequip an item from a slot
     */
    async unequipItem(characterId, slot) {
        const equipped = await this.getEquippedInSlot(characterId, slot);
        if (equipped) {
            await this.equippedItemRepo.delete(equipped.id);
            // TODO: Invalidate battle queue
            this.logger.debug(`Character ${characterId} unequipped from slot ${slot}`);
        }
    }
    /**
     * Validate weapon combination (dual wield rules per SPEC §5.3)
     * Valid combinations: Sword+Shield, Sword+Sword, Sword+Dagger, Dagger+Shield,
     * Dagger+Dagger, or 2H weapons (Greatsword, Bow, Staff, Wand) alone
     */
    async validateWeaponCombination(characterId, mainWeapon, offHandWeapon) {
        const errors = [];
        const current = await this.getEquipment(characterId);
        const mainEquipped = current.find((e) => e.slot === 'mainHand');
        const offEquipped = current.find((e) => e.slot === 'offHand');
        // Determine what will be equipped after this change
        const newMain = mainWeapon !== undefined
            ? this.dataService.getItemById(mainWeapon)
            : mainEquipped
                ? this.dataService.getItemById(mainEquipped.itemId)
                : null;
        const newOff = offHandWeapon !== undefined
            ? this.dataService.getItemById(offHandWeapon)
            : offEquipped
                ? this.dataService.getItemById(offEquipped.itemId)
                : null;
        if (!newMain && !mainWeapon) {
            // Unequipping main hand - always valid
            return { valid: true };
        }
        if (!newMain || newMain.type !== 'equipment') {
            return { valid: false, errors: ['Main hand must be a weapon'] };
        }
        const mainType = newMain?.weaponType;
        const isTwoHanded = ['greatsword', 'bow', 'staff', 'wand'].includes(mainType);
        // Two-handed weapons cannot have off-hand
        if (isTwoHanded && newOff) {
            errors.push(`${mainType} is two-handed and cannot have an off-hand weapon`);
        }
        // One-handed weapon validation
        if (!isTwoHanded && newOff) {
            const offType = newOff.weaponType;
            // Valid combinations: Sword+Shield, Sword+Sword, Sword+Dagger,
            // Dagger+Shield, Dagger+Dagger
            const validPairs = {
                sword: ['shield', 'sword', 'dagger'],
                dagger: ['shield', 'dagger'],
                bow: [], // Bow is always 2H
                staff: [], // Staff is always 2H
                wand: [], // Wand is always 2H
            };
            if (!validPairs[mainType] || !validPairs[mainType].includes(offType)) {
                errors.push(`Invalid weapon combination: ${mainType} + ${offType}`);
            }
        }
        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
        };
    }
    /**
     * Get character's current loadout summary
     */
    async getLoadoutSummary(characterId) {
        const equipped = await this.getEquipment(characterId);
        const stats = await this.calculateEquipmentStats(characterId);
        return {
            equipped: equipped.map((e) => ({
                slot: e.slot,
                itemId: e.itemId,
                itemName: this.dataService.getItemById(e.itemId)?.name,
                instanceData: e.instanceData,
            })),
            totalStats: stats,
        };
    }
};
exports.EquipmentService = EquipmentService;
exports.EquipmentService = EquipmentService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(equipped_item_entity_1.EquippedItem)),
    __param(1, (0, typeorm_1.InjectRepository)(character_entity_1.Character)),
    __param(2, (0, typeorm_1.InjectRepository)(weapon_proficiency_entity_1.WeaponProficiency)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService])
], EquipmentService);
//# sourceMappingURL=equipment.service.js.map