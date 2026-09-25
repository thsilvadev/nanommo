import { TownService } from './town.service';
export declare class TownController {
    private readonly townService;
    constructor(townService: TownService);
    /**
     * Get vendor NPC catalog
     */
    getVendorCatalog(): Promise<any[]>;
    /**
     * Get stock for a specific vendor
     */
    getVendorStock(vendorId: string): Promise<any[]>;
    /**
     * Buy item from vendor
     */
    buyFromVendor(req: any, vendorId: string, body: {
        itemId: string;
        quantity: number;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Get warehouse contents
     */
    getWarehouse(req: any): Promise<import("../../database/entities").InventoryItem[]>;
    /**
     * Get warehouse capacity info
     */
    getWarehouseCapacity(req: any): Promise<{
        used: number;
        max: number;
    }>;
    /**
     * Deposit item to warehouse
     */
    depositToWarehouse(req: any, body: {
        itemId: string;
        quantity: number;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Withdraw item from warehouse
     */
    withdrawFromWarehouse(req: any, body: {
        itemId: string;
        quantity: number;
    }): Promise<{
        success: boolean;
    }>;
    /**
     * Get list of town NPCs
     */
    getTownNPCs(): Promise<any[]>;
    /**
     * Interact with NPC
     */
    interactWithNPC(npcId: string, body: {
        action: string;
    }): Promise<any>;
    /**
     * Get town news/announcements
     */
    getTownNews(): Promise<any[]>;
}
//# sourceMappingURL=town.controller.d.ts.map