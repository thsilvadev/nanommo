import { Character } from './character.entity';
export declare class MarketOrder {
    id: string;
    characterId: string;
    character?: Character;
    type: 'sell' | 'buy';
    itemId: string;
    itemInstanceData?: any;
    quantity: number;
    pricePerUnit: number;
    escrowedItemQuantity?: number;
    escrowedGold?: number;
    status: string;
    createdAt: Date;
    expiresAt: Date;
}
//# sourceMappingURL=market-order.entity.d.ts.map