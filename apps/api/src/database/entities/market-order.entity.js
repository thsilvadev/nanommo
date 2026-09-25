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
exports.MarketOrder = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
let MarketOrder = class MarketOrder {
    id;
    characterId;
    character;
    type;
    itemId;
    itemInstanceData;
    quantity;
    pricePerUnit;
    escrowedItemQuantity;
    escrowedGold;
    status;
    createdAt;
    expiresAt;
};
exports.MarketOrder = MarketOrder;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], MarketOrder.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], MarketOrder.prototype, "characterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'characterId' }),
    __metadata("design:type", character_entity_1.Character)
], MarketOrder.prototype, "character", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['sell', 'buy'] }),
    __metadata("design:type", String)
], MarketOrder.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], MarketOrder.prototype, "itemId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], MarketOrder.prototype, "itemInstanceData", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], MarketOrder.prototype, "quantity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], MarketOrder.prototype, "pricePerUnit", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], MarketOrder.prototype, "escrowedItemQuantity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], MarketOrder.prototype, "escrowedGold", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['active', 'fulfilled', 'cancelled', 'expired'] }),
    __metadata("design:type", String)
], MarketOrder.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], MarketOrder.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], MarketOrder.prototype, "expiresAt", void 0);
exports.MarketOrder = MarketOrder = __decorate([
    (0, typeorm_1.Entity)('market_orders'),
    (0, typeorm_1.Index)(['characterId']),
    (0, typeorm_1.Index)(['itemId'])
], MarketOrder);
//# sourceMappingURL=market-order.entity.js.map