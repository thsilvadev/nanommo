import { InventoryService } from './inventory.service';
export declare class InventoryController {
    private readonly inventoryService;
    constructor(inventoryService: InventoryService);
    /**
     * Get full inventory for character
     */
    getInventory(req: any): Promise<import("../../database/entities").InventoryItem[]>;
    /**
     * Get warehouse items for character
     */
    getWarehouse(req: any): Promise<import("../../database/entities").InventoryItem[]>;
    /**
     * Get count of a specific item
     */
    getItemCount(req: any, itemId: string): Promise<{
        count: number;
    }>;
    /**
     * Add item to inventory
     */
    addItem(req: any, body: {
        itemId: string;
        quantity: number;
    }): Promise<import("../../database/entities").InventoryItem>;
    /**
     * Remove item from inventory
     */
    removeItem(req: any, body: {
        itemId: string;
        quantity: number;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Transfer item to warehouse
     */
    transferToWarehouse(req: any, body: {
        itemId: string;
        quantity: number;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Transfer item from warehouse
     */
    transferFromWarehouse(req: any, body: {
        itemId: string;
        quantity: number;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Sell item(s) to vendor
     */
    sellToVendor(req: any, body: {
        itemId: string;
        quantity: number;
    }): Promise<{
        goldReceived: number;
    }>;
}
//# sourceMappingURL=inventory.controller.d.ts.map