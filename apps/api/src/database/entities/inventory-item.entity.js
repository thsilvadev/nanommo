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
exports.InventoryItem = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
let InventoryItem = class InventoryItem {
    id;
    characterId;
    character;
    location;
    slotIndex;
    itemId;
    quantity;
    instanceData;
};
exports.InventoryItem = InventoryItem;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], InventoryItem.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], InventoryItem.prototype, "characterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'characterId' }),
    __metadata("design:type", character_entity_1.Character)
], InventoryItem.prototype, "character", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['inventory', 'warehouse'] }),
    __metadata("design:type", String)
], InventoryItem.prototype, "location", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], InventoryItem.prototype, "slotIndex", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], InventoryItem.prototype, "itemId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], InventoryItem.prototype, "quantity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], InventoryItem.prototype, "instanceData", void 0);
exports.InventoryItem = InventoryItem = __decorate([
    (0, typeorm_1.Entity)('inventory_items'),
    (0, typeorm_1.Unique)(['characterId', 'location', 'slotIndex']),
    (0, typeorm_1.Index)(['characterId'])
], InventoryItem);
//# sourceMappingURL=inventory-item.entity.js.map