import { EquipmentService } from './equipment.service';
export declare class EquipmentController {
    private readonly equipmentService;
    constructor(equipmentService: EquipmentService);
    /**
     * Get all equipped items for character
     */
    getEquipment(req: any): Promise<import("../../database/entities").EquippedItem[]>;
    /**
     * Get equipment loadout summary
     */
    getLoadoutSummary(req: any): Promise<any>;
    /**
     * Get item in specific slot
     */
    getEquippedInSlot(req: any, slot: string): Promise<import("../../database/entities").EquippedItem | null>;
    /**
     * Get total stat bonuses from equipment
     */
    getEquipmentStats(req: any): Promise<import("./equipment.service").EquipmentStats>;
    /**
     * Equip an item
     */
    equipItem(req: any, body: {
        slot: string;
        itemId: string;
    }): Promise<import("../../database/entities").EquippedItem>;
    /**
     * Unequip an item
     */
    unequipItem(req: any, slot: string): Promise<{
        success: boolean;
    }>;
    /**
     * Validate weapon combination
     */
    validateWeaponCombination(req: any, body: {
        mainWeapon: string;
        offHandWeapon?: string;
    }): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
}
//# sourceMappingURL=equipment.controller.d.ts.map