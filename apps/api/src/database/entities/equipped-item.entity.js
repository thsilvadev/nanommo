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
exports.EquippedItem = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
let EquippedItem = class EquippedItem {
    id;
    characterId;
    character;
    slot;
    itemId;
    instanceData;
};
exports.EquippedItem = EquippedItem;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], EquippedItem.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], EquippedItem.prototype, "characterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'characterId' }),
    __metadata("design:type", character_entity_1.Character)
], EquippedItem.prototype, "character", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['head', 'body', 'mainHand', 'offHand', 'shoes', 'cape', 'accessoryLeft', 'accessoryRight'] }),
    __metadata("design:type", String)
], EquippedItem.prototype, "slot", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], EquippedItem.prototype, "itemId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], EquippedItem.prototype, "instanceData", void 0);
exports.EquippedItem = EquippedItem = __decorate([
    (0, typeorm_1.Entity)('equipped_items'),
    (0, typeorm_1.Unique)(['characterId', 'slot']),
    (0, typeorm_1.Index)(['characterId'])
], EquippedItem);
//# sourceMappingURL=equipped-item.entity.js.map