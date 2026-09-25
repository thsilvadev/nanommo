import { Character } from './character.entity';
export declare class MailMessage {
    id: string;
    recipientCharacterId: string;
    recipientCharacter?: Character;
    itemId?: string;
    itemInstanceData?: any;
    quantity?: number;
    subject: string;
    createdAt: Date;
    expiresAt: Date;
    collected: boolean;
}
//# sourceMappingURL=mail-message.entity.d.ts.map