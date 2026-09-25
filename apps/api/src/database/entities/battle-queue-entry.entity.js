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
exports.BattleQueueEntry = void 0;
const typeorm_1 = require("typeorm");
const character_entity_1 = require("./character.entity");
let BattleQueueEntry = class BattleQueueEntry {
    id;
    characterId;
    character;
    sequenceIndex;
    mapId;
    monsterId;
    startAt;
    endAt;
    outcome;
    log;
    xpGain;
    goldGain;
    drops;
    hpAfter;
    spAfter;
    resolved;
    seedUsed;
};
exports.BattleQueueEntry = BattleQueueEntry;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], BattleQueueEntry.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], BattleQueueEntry.prototype, "characterId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => character_entity_1.Character),
    (0, typeorm_1.JoinColumn)({ name: 'characterId' }),
    __metadata("design:type", character_entity_1.Character)
], BattleQueueEntry.prototype, "character", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], BattleQueueEntry.prototype, "sequenceIndex", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], BattleQueueEntry.prototype, "mapId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], BattleQueueEntry.prototype, "monsterId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], BattleQueueEntry.prototype, "startAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], BattleQueueEntry.prototype, "endAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['win', 'loss'] }),
    __metadata("design:type", String)
], BattleQueueEntry.prototype, "outcome", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb' }),
    __metadata("design:type", Object)
], BattleQueueEntry.prototype, "log", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint' }),
    __metadata("design:type", Number)
], BattleQueueEntry.prototype, "xpGain", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], BattleQueueEntry.prototype, "goldGain", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', default: '[]' }),
    __metadata("design:type", Array)
], BattleQueueEntry.prototype, "drops", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], BattleQueueEntry.prototype, "hpAfter", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], BattleQueueEntry.prototype, "spAfter", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], BattleQueueEntry.prototype, "resolved", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], BattleQueueEntry.prototype, "seedUsed", void 0);
exports.BattleQueueEntry = BattleQueueEntry = __decorate([
    (0, typeorm_1.Entity)('battle_queue_entries'),
    (0, typeorm_1.Index)(['characterId', 'sequenceIndex'])
], BattleQueueEntry);
//# sourceMappingURL=battle-queue-entry.entity.js.map