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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var CharacterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CharacterService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../database/entities");
const shared_1 = require("@nanommo/shared");
const data_service_1 = require("../data/data.service");
let CharacterService = CharacterService_1 = class CharacterService {
    characterRepository;
    weaponProficiencyRepository;
    dataService;
    logger = new common_1.Logger(CharacterService_1.name);
    constructor(characterRepository, weaponProficiencyRepository, dataService) {
        this.characterRepository = characterRepository;
        this.weaponProficiencyRepository = weaponProficiencyRepository;
        this.dataService = dataService;
    }
    async createCharacter(userId, username) {
        // Check if character already exists
        const existing = await this.characterRepository.findOne({
            where: { userId },
        });
        if (existing) {
            throw new common_1.BadRequestException('Character already exists for this user');
        }
        // Calculate base stats
        const baseStats = shared_1.BattleEngine.calculateDerivedStats(1, {
            str: 5,
            agi: 5,
            dex: 5,
            vit: 5,
            int: 5,
            sor: 5,
        }, {});
        // Create character
        const character = this.characterRepository.create({
            userId,
            name: username,
            level: 1,
            xp: 0,
            unspentAttributePoints: 0,
            str: 5,
            agi: 5,
            dex: 5,
            vit: 5,
            int: 5,
            sor: 5,
            gold: 0,
            hpCurrent: baseStats.maxHp,
            spCurrent: baseStats.maxSp,
            status: 'town',
            lastSeenAt: new Date(),
        });
        const savedCharacter = await this.characterRepository.save(character);
        // Create weapon proficiencies for all 7 weapon types
        const weaponTypes = [
            shared_1.WeaponType.SWORD,
            shared_1.WeaponType.GREATSWORD,
            shared_1.WeaponType.DAGGER,
            shared_1.WeaponType.BOW,
            shared_1.WeaponType.STAFF,
            shared_1.WeaponType.WAND,
            shared_1.WeaponType.SHIELD,
        ];
        for (const weaponType of weaponTypes) {
            const proficiency = this.weaponProficiencyRepository.create({
                characterId: savedCharacter.id,
                weaponType,
                level: 1,
                xp: 0,
            });
            await this.weaponProficiencyRepository.save(proficiency);
        }
        return this.toDto(savedCharacter);
    }
    async getCharacterByUserId(userId) {
        return this.characterRepository.findOne({
            where: { userId },
        });
    }
    async getCharacterById(characterId) {
        return this.characterRepository.findOne({
            where: { id: characterId },
        });
    }
    async spendAttributePoints(characterId, attributes) {
        const character = await this.getCharacterById(characterId);
        if (!character) {
            throw new common_1.NotFoundException('Character not found');
        }
        const totalToSpend = Object.values(attributes).reduce((sum, val) => sum + (val ?? 0), 0);
        if (totalToSpend > character.unspentAttributePoints) {
            throw new common_1.BadRequestException('Not enough unspent attribute points');
        }
        // Update attributes
        if (attributes.str)
            character.str += attributes.str;
        if (attributes.agi)
            character.agi += attributes.agi;
        if (attributes.dex)
            character.dex += attributes.dex;
        if (attributes.vit)
            character.vit += attributes.vit;
        if (attributes.int)
            character.int += attributes.int;
        if (attributes.sor)
            character.sor += attributes.sor;
        character.unspentAttributePoints -= totalToSpend;
        const saved = await this.characterRepository.save(character);
        return this.toDto(saved);
    }
    async gainXp(characterId, xpAmount) {
        const character = await this.getCharacterById(characterId);
        if (!character)
            return;
        character.xp += xpAmount;
        // Check for level-ups
        while (character.level < 99) {
            const xpToNext = this.dataService.getXpToNextLevel(character.level);
            if (character.xp >= xpToNext) {
                character.level++;
                character.xp -= xpToNext;
                character.unspentAttributePoints += 5;
                // Recalculate HP/SP (ratio-adjusted)
                const oldStats = shared_1.BattleEngine.calculateDerivedStats(character.level - 1, {
                    str: character.str,
                    agi: character.agi,
                    dex: character.dex,
                    vit: character.vit,
                    int: character.int,
                    sor: character.sor,
                }, {});
                const newStats = shared_1.BattleEngine.calculateDerivedStats(character.level, {
                    str: character.str,
                    agi: character.agi,
                    dex: character.dex,
                    vit: character.vit,
                    int: character.int,
                    sor: character.sor,
                }, {});
                character.hpCurrent = Math.round(character.hpCurrent * (newStats.maxHp / oldStats.maxHp));
                character.spCurrent = Math.round(character.spCurrent * (newStats.maxSp / oldStats.maxSp));
            }
            else {
                break;
            }
        }
        await this.characterRepository.save(character);
    }
    toDto(character) {
        return {
            id: character.id,
            userId: character.userId,
            name: character.name,
            level: character.level,
            xp: character.xp,
            unspentAttributePoints: character.unspentAttributePoints,
            str: character.str,
            agi: character.agi,
            dex: character.dex,
            vit: character.vit,
            int: character.int,
            sor: character.sor,
            gold: Number(character.gold),
            hpCurrent: character.hpCurrent,
            spCurrent: character.spCurrent,
            currentMapId: character.currentMapId || undefined,
            status: character.status,
            activeGambitPageId: character.activeGambitPageId || undefined,
            lastSeenAt: character.lastSeenAt,
            createdAt: character.createdAt,
            updatedAt: character.updatedAt,
        };
    }
};
exports.CharacterService = CharacterService;
exports.CharacterService = CharacterService = CharacterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Character)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.WeaponProficiency)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService])
], CharacterService);
//# sourceMappingURL=character.service.js.map