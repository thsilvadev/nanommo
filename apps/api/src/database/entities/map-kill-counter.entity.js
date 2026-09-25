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
exports.MapKillCounter = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
let MapKillCounter = class MapKillCounter {
    id;
    characterId;
    character;
    mapId;
    epoch;
    mapKillCount;
    perMonsterKillCount;
};
exports.MapKillCounter = MapKillCounter;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], MapKillCounter.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], MapKillCounter.prototype, "characterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'characterId' }),
    __metadata("design:type", character_entity_1.Character)
], MapKillCounter.prototype, "character", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], MapKillCounter.prototype, "mapId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], MapKillCounter.prototype, "epoch", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], MapKillCounter.prototype, "mapKillCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: '{}' }),
    __metadata("design:type", Object)
], MapKillCounter.prototype, "perMonsterKillCount", void 0);
exports.MapKillCounter = MapKillCounter = __decorate([
    (0, typeorm_1.Entity)('map_kill_counters'),
    (0, typeorm_1.Unique)(['characterId', 'mapId']),
    (0, typeorm_1.Index)(['characterId'])
], MapKillCounter);
//# sourceMappingURL=map-kill-counter.entity.js.map