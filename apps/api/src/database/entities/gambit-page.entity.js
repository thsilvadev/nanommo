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
exports.GambitPage = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
let GambitPage = class GambitPage {
    id;
    characterId;
    character;
    slotIndex;
    title;
    lines;
};
exports.GambitPage = GambitPage;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], GambitPage.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], GambitPage.prototype, "characterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'characterId' }),
    __metadata("design:type", character_entity_1.Character)
], GambitPage.prototype, "character", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], GambitPage.prototype, "slotIndex", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 30, nullable: true }),
    __metadata("design:type", String)
], GambitPage.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: '[]' }),
    __metadata("design:type", Array)
], GambitPage.prototype, "lines", void 0);
exports.GambitPage = GambitPage = __decorate([
    (0, typeorm_1.Entity)('gambit_pages'),
    (0, typeorm_1.Index)(['characterId'])
], GambitPage);
//# sourceMappingURL=gambit-page.entity.js.map