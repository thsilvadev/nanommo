import { Character } from './character.entity';
export declare class MarketDeal {
    id: string;
    buyerCharacterId: string;
    buyerCharacter?: Character;
    sellerCharacterId: string;
    sellerCharacter?: Character;
    itemId: string;
    itemInstanceData?: any;
    quantity: number;
    pricePerUnit: number;
    feeCollected: number;
    dealAt: Date;
}
//# sourceMappingURL=market-deal.entity.d.ts.map