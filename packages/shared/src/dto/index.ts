import { Attribute } from '../types';

// Auth DTOs
export class RegisterDto {
  email!: string;
  password!: string;
}

export class LoginDto {
  identifier!: string;
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
  name!: string;
  dominantHand!: 'right' | 'left';
}

export class SpendAttributePointsDto {
  attributes!: Partial<Record<Attribute, number>>;
}

export class SetAutoFeedDto {
  enabled!: boolean;
}

export class CharacterDto {
  id!: string;
  userId!: string;
  name!: string;
  dominantHand!: 'right' | 'left';
  knownItemIds!: string[];
  level!: number;
  xp!: number;
  xpToNext!: number;
  unspentAttributePoints!: number;
  str!: number;
  agi!: number;
  dex!: number;
  vit!: number;
  int!: number;
  luk!: number;
  attributeBonuses!: Record<string, number>;
  gold!: number;
  hpCurrent!: number;
  spCurrent!: number;
  maxHp!: number;
  maxSp!: number;
  attack!: number;
  magicAttack!: number;
  defense!: number;
  attackSpeed!: number;
  castTimeReduction!: number;
  evasion!: number;
  accuracy!: number;
  hpRegenPerTenTicks!: number;
  spRegenPerTenTicks!: number;
  criticalChance!: number;
  hungry!: boolean;
  foodBuffExpiresAt?: Date;
  diet!: Array<{ itemId: string; consumedAt: string; digestUntil: string; dietLevel: number }>;
  dietLevels!: Record<string, { level: number; lastDigestUntil: string }>;
  autoFeed!: boolean;
  currentMapId!: string;
  savedTownMapId!: string | null;
  lastGrindStance!: 'hunting' | 'gathering';
  travelIntent?: any | null;
  gatheringLevel!: number;
  gatheringXp!: number;
  cookingLevel!: number;
  cookingXp!: number;
  cookingSession?: any | null;
  alchemyLevel!: number;
  alchemyXp!: number;
  blacksmithLevel!: number;
  blacksmithXp!: number;
  craftingSession?: any | null;
  moveSpeed!: number;
  gatheringCycle!: any;
  encounterCycle!: any;
  fleeAttemptIndex!: number;
  fleeNextAttemptAt?: Date | null;
  pendingMapTransition?: { destinationMapId: string; reason: 'town_request' | 'map_request'; requestedAt?: string } | null;
  discoveredMapIds!: string[];
  status!: string;
  activeGambitPageId?: string;
  lastSeenAt!: Date;
  /** Absolute cooldown deadlines keyed by item:potion or item:<itemId>. */
  consumableCooldowns!: Record<string, string>;
  createdAt!: Date;
  updatedAt!: Date;
  stateVersion!: number;
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
