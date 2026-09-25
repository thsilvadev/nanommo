import { Repository } from 'typeorm';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
export declare class InventoryService {
    private readonly inventoryItemRepo;
    private readonly characterRepo;
    private readonly dataService;
    private readonly logger;
    constructor(inventoryItemRepo: Repository<InventoryItem>, characterRepo: Repository<Character>, dataService: DataService);
    /**
     * Get all inventory items for a character
     */
    getInventory(characterId: string): Promise<InventoryItem[]>;
    /**
     * Get all warehouse items for a character
     */
    getWarehouse(characterId: string): Promise<InventoryItem[]>;
    /**
     * Get inventory item count for a specific item
     */
    getItemCount(characterId: string, itemId: string): Promise<number>;
    /**
     * Check if location has free slots
     */
    private getFreeSlots;
    /**
     * Get next available slot index
     */
    private getNextSlot;
    /**
     * Add item(s) to inventory or warehouse with automatic stacking
     * Falls back to warehouse if inventory is full
     */
    addItem(characterId: string, itemId: string, quantity: number, location?: 'inventory' | 'warehouse', instanceData?: any): Promise<InventoryItem>;
    /**
     * Remove item(s) from inventory
     */
    removeItem(characterId: string, itemId: string, quantity: number): Promise<void>;
    /**
     * Move item between inventory and warehouse
     */
    transferItem(characterId: string, itemId: string, quantity: number, fromLocation: 'inventory' | 'warehouse', toLocation: 'inventory' | 'warehouse'): Promise<InventoryItem>;
    /**
     * Transfer item to warehouse (convenience method)
     */
    transferToWarehouse(characterId: string, itemId: string, quantity: number): Promise<InventoryItem>;
    /**
     * Transfer item from warehouse (convenience method)
     */
    transferFromWarehouse(characterId: string, itemId: string, quantity: number): Promise<InventoryItem>;
    /**
     * Sell item to vendor (removes from inventory, adds gold to character)
     */
    sellToVendor(characterId: string, itemId: string, quantity: number): Promise<number>;
    /**
     * Process battle drops into inventory
     */
    processBattleDrops(characterId: string, drops: Array<{
        itemId: string;
        quantity: number;
    }>): Promise<InventoryItem[]>;
}
//# sourceMappingURL=inventory.service.d.ts.map