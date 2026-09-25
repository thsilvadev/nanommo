import { Character } from './character.entity';
export declare class InventoryItem {
    id: string;
    characterId: string;
    character?: Character;
    location: 'inventory' | 'warehouse';
    slotIndex: number;
    itemId: string;
    quantity: number;
    instanceData?: any;
}
//# sourceMappingURL=inventory-item.entity.d.ts.map