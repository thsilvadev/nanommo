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
exports.WeaponProficiency = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
const shared_1 = require("@nanommo/shared");
let WeaponProficiency = class WeaponProficiency {
    id;
    characterId;
    character;
    weaponType;
    level;
    xp;
};
exports.WeaponProficiency = WeaponProficiency;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], WeaponProficiency.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], WeaponProficiency.prototype, "characterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'characterId' }),
    __metadata("design:type", character_entity_1.Character)
], WeaponProficiency.prototype, "character", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['sword', 'greatsword', 'dagger', 'bow', 'staff', 'wand', 'shield'] }),
    __metadata("design:type", String)
], WeaponProficiency.prototype, "weaponType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], WeaponProficiency.prototype, "level", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint', default: 0 }),
    __metadata("design:type", Number)
], WeaponProficiency.prototype, "xp", void 0);
exports.WeaponProficiency = WeaponProficiency = __decorate([
    (0, typeorm_1.Entity)('weapon_proficiencies'),
    (0, typeorm_1.Unique)(['characterId', 'weaponType']),
    (0, typeorm_1.Index)(['characterId'])
], WeaponProficiency);
//# sourceMappingURL=weapon-proficiency.entity.js.map