import { Repository } from 'typeorm';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { DataService } from '../data/data.service';
export declare class TownService {
    private readonly characterRepo;
    private readonly inventoryItemRepo;
    private readonly dataService;
    constructor(characterRepo: Repository<Character>, inventoryItemRepo: Repository<InventoryItem>, dataService: DataService);
    /**
     * Get vendor catalog for sale
     */
    getVendorCatalog(): Promise<any[]>;
    /**
     * Get items for sale by a specific vendor NPC
     */
    getVendorStock(vendorId: string): Promise<any[]>;
    /**
     * Buy item from vendor
     */
    buyFromVendor(characterId: string, vendorId: string, itemId: string, quantity: number): Promise<void>;
    /**
     * Get warehouse contents for character
     */
    getWarehouse(characterId: string): Promise<InventoryItem[]>;
    /**
     * Get warehouse capacity
     */
    getWarehouseCapacity(characterId: string): Promise<{
        used: number;
        max: number;
    }>;
    /**
     * Transfer item to warehouse from inventory
     */
    depositToWarehouse(characterId: string, itemId: string, quantity: number): Promise<void>;
    /**
     * Transfer item from warehouse to inventory
     */
    withdrawFromWarehouse(characterId: string, itemId: string, quantity: number): Promise<void>;
    /**
     * Get list of NPCs in town
     */
    getTownNPCs(): Promise<any[]>;
    /**
     * Interact with a town NPC
     */
    interactWithNPC(npcId: string, action: string): Promise<any>;
    /**
     * Get town announcements/news
     */
    getTownNews(): Promise<any[]>;
}
//# sourceMappingURL=town.service.d.ts.map