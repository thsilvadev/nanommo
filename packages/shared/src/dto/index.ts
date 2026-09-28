import { Attribute } from '../types';

// Auth DTOs
export class RegisterDto {
  username!: string;
  email!: string;
  password!: string;
  cpf!: string;
}

export class LoginDto {
  username!: string;
  password!: string;
}

export class AuthTokenDto {
  accessToken!: string;
  refreshToken!: string;
  expiresIn!: number;
}

export class ForgotPasswordDto {
  email!: string;
}

export class ResetPasswordDto {
  token!: string;
  newPassword!: string;
}

// Character DTOs
export class CreateCharacterDto {
  username!: string;
}

export class SpendAttributePointsDto {
  attributes!: Partial<Record<Attribute, number>>;
}

export class CharacterDto {
  id!: string;
  userId!: string;
  name!: string;
  level!: number;
  xp!: number;
  unspentAttributePoints!: number;
  str!: number;
  agi!: number;
  dex!: number;
  vit!: number;
  int!: number;
  sor!: number;
  gold!: number;
  hpCurrent!: number;
  spCurrent!: number;
  currentMapId?: string;
  status!: string;
  activeGambitPageId?: string;
  lastSeenAt!: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

// Gambit DTOs
export class UpdateGambitPageDto {
  title?: string;
  lines!: any[];
}

export class GambitPageDto {
  id!: string;
  characterId!: string;
  slotIndex!: number;
  title?: string;
  lines!: any[];
}

// Equipment DTOs
export class EquipItemDto {
  slot!: string;
  itemId!: string;
}

export class UnequipItemDto {
  slot!: string;
}

// Map & Battle DTOs
export class EnterMapDto {
  mapId!: string;
}

export class BattleQueueEntryDto {
  id!: string;
  sequenceIndex!: number;
  mapId!: string;
  monsterId!: string;
  startAt!: Date;
  endAt!: Date;
  outcome!: string;
}

// Market DTOs
export class PlaceMarketOrderDto {
  type!: 'sell' | 'buy';
  itemId!: string;
  quantity!: number;
  pricePerUnit!: number;
}

export class MarketOrderDto {
  id!: string;
  characterId!: string;
  type!: string;
  itemId!: string;
  quantity!: number;
  pricePerUnit!: number;
  status!: string;
  createdAt!: Date;
  expiresAt!: Date;
}

// Mail DTOs
export class MailMessageDto {
  id!: string;
  recipientCharacterId!: string;
  itemId?: string;
  quantity?: number;
  subject!: string;
  createdAt!: Date;
  expiresAt!: Date;
  collected!: boolean;
}

// Chat DTOs
export class SendChatMessageDto {
  channel!: 'global' | 'town';
  message!: string;
}

export class ChatMessageDto {
  characterId!: string;
  characterName!: string;
  channel!: string;
  message!: string;
  timestamp!: Date;
}
