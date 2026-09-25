"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketDeal = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
let MarketDeal = class MarketDeal {
    id;
    buyerCharacterId;
    buyerCharacter;
    sellerCharacterId;
    sellerCharacter;
    itemId;
    itemInstanceData;
    quantity;
    pricePerUnit;
    feeCollected;
    dealAt;
};
exports.MarketDeal = MarketDeal;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], MarketDeal.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], MarketDeal.prototype, "buyerCharacterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'buyerCharacterId' }),
    __metadata("design:type", character_entity_1.Character)
], MarketDeal.prototype, "buyerCharacter", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], MarketDeal.prototype, "sellerCharacterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'sellerCharacterId' }),
    __metadata("design:type", character_entity_1.Character)
], MarketDeal.prototype, "sellerCharacter", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], MarketDeal.prototype, "itemId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], MarketDeal.prototype, "itemInstanceData", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], MarketDeal.prototype, "quantity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], MarketDeal.prototype, "pricePerUnit", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint' }),
    __metadata("design:type", Number)
], MarketDeal.prototype, "feeCollected", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], MarketDeal.prototype, "dealAt", void 0);
exports.MarketDeal = MarketDeal = __decorate([
    (0, typeorm_1.Entity)('market_deals'),
    (0, typeorm_1.Index)(['buyerCharacterId']),
    (0, typeorm_1.Index)(['sellerCharacterId'])
], MarketDeal);
//# sourceMappingURL=market-deal.entity.js.map