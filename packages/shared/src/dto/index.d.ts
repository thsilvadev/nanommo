import { Attribute } from '../types';
export declare class RegisterDto {
    username: string;
    email: string;
    password: string;
    cpf: string;
}
export declare class LoginDto {
    username: string;
    password: string;
}
export declare class AuthTokenDto {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
export declare class CreateCharacterDto {
    username: string;
}
export declare class SpendAttributePointsDto {
    attributes: Partial<Record<Attribute, number>>;
}
export declare class CharacterDto {
    id: string;
    userId: string;
    name: string;
    level: number;
    xp: number;
    unspentAttributePoints: number;
    str: number;
    agi: number;
    dex: number;
    vit: number;
    int: number;
    sor: number;
    gold: number;
    hpCurrent: number;
    spCurrent: number;
    currentMapId?: string;
    status: string;
    activeGambitPageId?: string;
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
export declare class UpdateGambitPageDto {
    title?: string;
    lines: any[];
}
export declare class GambitPageDto {
    id: string;
    characterId: string;
    slotIndex: number;
    title?: string;
    lines: any[];
}
export declare class EquipItemDto {
    slot: string;
    itemId: string;
}
export declare class UnequipItemDto {
    slot: string;
}
export declare class EnterMapDto {
    mapId: string;
}
export declare class BattleQueueEntryDto {
    id: string;
    sequenceIndex: number;
    mapId: string;
    monsterId: string;
    startAt: Date;
    endAt: Date;
    outcome: string;
}
export declare class PlaceMarketOrderDto {
    type: 'sell' | 'buy';
    itemId: string;
    quantity: number;
    pricePerUnit: number;
}
export declare class MarketOrderDto {
    id: string;
    characterId: string;
    type: string;
    itemId: string;
    quantity: number;
    pricePerUnit: number;
    status: string;
    createdAt: Date;
    expiresAt: Date;
}
export declare class MailMessageDto {
    id: string;
    recipientCharacterId: string;
    itemId?: string;
    quantity?: number;
    subject: string;
    createdAt: Date;
    expiresAt: Date;
    collected: boolean;
}
export declare class SendChatMessageDto {
    channel: 'global' | 'town';
    message: string;
}
export declare class ChatMessageDto {
    characterId: string;
    characterName: string;
    channel: string;
    message: string;
    timestamp: Date;
}
//# sourceMappingURL=index.d.ts.map