import { Repository } from 'typeorm';
import { EquippedItem } from '../../database/entities/equipped-item.entity';
import { Character } from '../../database/entities/character.entity';
import { WeaponProficiency } from '../../database/entities/weapon-proficiency.entity';
import { DataService } from '../data/data.service';
export interface EquipmentStats {
    def: number;
    mdefPercent: number;
    statBonus: {
        STR?: number;
        AGI?: number;
        DEX?: number;
        VIT?: number;
        INT?: number;
        SOR?: number;
    };
    weaponFixedAtk?: number;
    weaponFixedMatk?: number;
}
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
export declare class EquipmentService {
    private readonly equippedItemRepo;
    private readonly characterRepo;
    private readonly weaponProfRepo;
    private readonly dataService;
    private readonly logger;
    constructor(equippedItemRepo: Repository<EquippedItem>, characterRepo: Repository<Character>, weaponProfRepo: Repository<WeaponProficiency>, dataService: DataService);
    /**
     * Get all equipped items for a character
     */
    getEquipment(characterId: string): Promise<EquippedItem[]>;
    /**
     * Get item equipped in a specific slot
     */
    getEquippedInSlot(characterId: string, slot: string): Promise<EquippedItem | null>;
    /**
     * Calculate total equipment stats (DEF, MDEF%, attribute bonuses)
     * Used in character stats calculation
     */
    calculateEquipmentStats(characterId: string): Promise<EquipmentStats>;
    /**
     * Calculate derived stats for a character with current equipment
     */
    calculateDerivedStats(character: Character): Promise<DerivedStats>;
    /**
     * Equip an item in a slot
     * Validates compatibility and triggers battle queue invalidation
     */
    equipItem(characterId: string, slot: string, itemId: string): Promise<EquippedItem>;
    /**
     * Unequip an item from a slot
     */
    unequipItem(characterId: string, slot: string): Promise<void>;
    /**
     * Validate weapon combination (dual wield rules per SPEC §5.3)
     * Valid combinations: Sword+Shield, Sword+Sword, Sword+Dagger, Dagger+Shield,
     * Dagger+Dagger, or 2H weapons (Greatsword, Bow, Staff, Wand) alone
     */
    validateWeaponCombination(characterId: string, mainWeapon?: string, offHandWeapon?: string): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
    /**
     * Get character's current loadout summary
     */
    getLoadoutSummary(characterId: string): Promise<any>;
}
//# sourceMappingURL=equipment.service.d.ts.map