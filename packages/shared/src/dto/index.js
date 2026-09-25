"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessageDto = exports.SendChatMessageDto = exports.MailMessageDto = exports.MarketOrderDto = exports.PlaceMarketOrderDto = exports.BattleQueueEntryDto = exports.EnterMapDto = exports.UnequipItemDto = exports.EquipItemDto = exports.GambitPageDto = exports.UpdateGambitPageDto = exports.CharacterDto = exports.SpendAttributePointsDto = exports.CreateCharacterDto = exports.AuthTokenDto = exports.LoginDto = exports.RegisterDto = void 0;
// Auth DTOs
class RegisterDto {
    username;
    email;
    password;
    cpf;
}
exports.RegisterDto = RegisterDto;
class LoginDto {
    username;
    password;
}
exports.LoginDto = LoginDto;
class AuthTokenDto {
    accessToken;
    refreshToken;
    expiresIn;
}
exports.AuthTokenDto = AuthTokenDto;
// Character DTOs
class CreateCharacterDto {
    username;
}
exports.CreateCharacterDto = CreateCharacterDto;
class SpendAttributePointsDto {
    attributes;
}
exports.SpendAttributePointsDto = SpendAttributePointsDto;
class CharacterDto {
    id;
    userId;
    name;
    level;
    xp;
    unspentAttributePoints;
    str;
    agi;
    dex;
    vit;
    int;
    sor;
    gold;
    hpCurrent;
    spCurrent;
    currentMapId;
    status;
    activeGambitPageId;
    lastSeenAt;
    createdAt;
    updatedAt;
}
exports.CharacterDto = CharacterDto;
// Gambit DTOs
class UpdateGambitPageDto {
    title;
    lines;
}
exports.UpdateGambitPageDto = UpdateGambitPageDto;
class GambitPageDto {
    id;
    characterId;
    slotIndex;
    title;
    lines;
}
exports.GambitPageDto = GambitPageDto;
// Equipment DTOs
class EquipItemDto {
    slot;
    itemId;
}
exports.EquipItemDto = EquipItemDto;
class UnequipItemDto {
    slot;
}
exports.UnequipItemDto = UnequipItemDto;
// Map & Battle DTOs
class EnterMapDto {
    mapId;
}
exports.EnterMapDto = EnterMapDto;
class BattleQueueEntryDto {
    id;
    sequenceIndex;
    mapId;
    monsterId;
    startAt;
    endAt;
    outcome;
}
exports.BattleQueueEntryDto = BattleQueueEntryDto;
// Market DTOs
class PlaceMarketOrderDto {
    type;
    itemId;
    quantity;
    pricePerUnit;
}
exports.PlaceMarketOrderDto = PlaceMarketOrderDto;
class MarketOrderDto {
    id;
    characterId;
    type;
    itemId;
    quantity;
    pricePerUnit;
    status;
    createdAt;
    expiresAt;
}
exports.MarketOrderDto = MarketOrderDto;
// Mail DTOs
class MailMessageDto {
    id;
    recipientCharacterId;
    itemId;
    quantity;
    subject;
    createdAt;
    expiresAt;
    collected;
}
exports.MailMessageDto = MailMessageDto;
// Chat DTOs
class SendChatMessageDto {
    channel;
    message;
}
exports.SendChatMessageDto = SendChatMessageDto;
class ChatMessageDto {
    characterId;
    characterName;
    channel;
    message;
    timestamp;
}
exports.ChatMessageDto = ChatMessageDto;
