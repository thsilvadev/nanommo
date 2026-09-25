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
var BattleService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleService = void 0;
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../database/entities");
const shared_1 = require("@nanommo/shared");
const data_service_1 = require("../data/data.service");
const character_service_1 = require("../character/character.service");
const inventory_service_1 = require("../inventory/inventory.service");
const equipment_service_1 = require("../equipment/equipment.service");
const gateway_service_1 = require("../gateway/gateway.service");
const redis_provider_1 = require("../../config/redis.provider");
const ioredis_1 = require("ioredis");
let BattleService = BattleService_1 = class BattleService {
    bullQueue;
    battleQueueRepo;
    characterRepo;
    mapKillCounterRepo;
    gambitPageRepo;
    dataService;
    characterService;
    inventoryService;
    equipmentService;
    gatewayService;
    redis;
    logger = new common_1.Logger(BattleService_1.name);
    QUEUE_DEPTH_TARGET = 5;
    AVERAGE_BATTLE_DURATION_MS = 15000; // 15 seconds average
    constructor(bullQueue, battleQueueRepo, characterRepo, mapKillCounterRepo, gambitPageRepo, dataService, characterService, inventoryService, equipmentService, gatewayService, redis) {
        this.bullQueue = bullQueue;
        this.battleQueueRepo = battleQueueRepo;
        this.characterRepo = characterRepo;
        this.mapKillCounterRepo = mapKillCounterRepo;
        this.gambitPageRepo = gambitPageRepo;
        this.dataService = dataService;
        this.characterService = characterService;
        this.inventoryService = inventoryService;
        this.equipmentService = equipmentService;
        this.gatewayService = gatewayService;
        this.redis = redis;
    }
    /**
     * Get the current battle queue for a character
     */
    async getBattleQueue(characterId, limit = 5) {
        return this.battleQueueRepo.find({
            where: { characterId, resolved: false },
            order: { sequenceIndex: 'ASC' },
            take: limit,
        });
    }
    /**
     * Get a single battle by ID
     */
    async getBattleById(battleId) {
        return this.battleQueueRepo.findOne({
            where: { id: battleId },
        });
    }
    /**
     * Queue multiple battles until reaching target depth
     */
    async queueBattles(characterId, targetDepth = this.QUEUE_DEPTH_TARGET) {
        const character = await this.characterRepo.findOne({ where: { id: characterId } });
        if (!character)
            throw new common_1.NotFoundException('Character not found');
        if (!character.currentMapId) {
            throw new common_1.BadRequestException('Character is not on a map');
        }
        // Get current queue depth
        const currentQueue = await this.getBattleQueue(characterId, targetDepth);
        const queueDepth = currentQueue.length;
        if (queueDepth >= targetDepth) {
            return currentQueue; // Already at target depth
        }
        const battlesToAdd = targetDepth - queueDepth;
        const newBattles = [];
        // Calculate next sequence index
        const maxSequenceIndex = currentQueue.length > 0
            ? Math.max(...currentQueue.map(b => b.sequenceIndex))
            : -1;
        // Load gambit page if exists
        let gambitPage = null;
        if (character.activeGambitPageId) {
            gambitPage = await this.gambitPageRepo.findOne({
                where: { id: character.activeGambitPageId },
            });
        }
        let nextStartTime = currentQueue.length > 0
            ? currentQueue[currentQueue.length - 1].endAt
            : new Date();
        // Simulate and queue battles
        for (let i = 0; i < battlesToAdd; i++) {
            const sequenceIndex = maxSequenceIndex + 1 + i;
            // Select monster deterministically
            const monsterId = await this.selectNextMonster(characterId, character.currentMapId);
            const monsterDef = this.dataService.getMonsterById(monsterId);
            if (!monsterDef)
                throw new Error('Monster not found');
            // Create deterministic seed
            const seed = `${characterId}:${character.currentMapId}:${monsterId}:${sequenceIndex}`;
            // Simulate battle
            const simulationResult = await this.simulateBattle(character, monsterDef, gambitPage, seed);
            // Calculate battle duration
            const battleDurationMs = Math.ceil((simulationResult.tickCount || 20) * 750); // ~750ms per tick average
            // Create queue entry
            const entry = this.battleQueueRepo.create({
                characterId,
                sequenceIndex,
                mapId: character.currentMapId,
                monsterId,
                startAt: new Date(nextStartTime),
                endAt: new Date(nextStartTime.getTime() + battleDurationMs),
                outcome: simulationResult.outcome,
                log: simulationResult.log,
                xpGain: simulationResult.xpGain,
                goldGain: simulationResult.goldGain,
                drops: simulationResult.drops || [],
                hpAfter: simulationResult.hpAfter,
                spAfter: simulationResult.spAfter,
                resolved: false,
                seedUsed: seed,
            });
            const saved = await this.battleQueueRepo.save(entry);
            newBattles.push(saved);
            // Schedule the resolve job for when battle ends
            const delayMs = saved.endAt.getTime() - new Date().getTime();
            await this.bullQueue.add('resolve-battle', { battleId: saved.id }, {
                delay: Math.max(0, delayMs), // Ensure positive delay
                jobId: saved.id, // Prevent duplicates
                attempts: 3, // Retry up to 3 times
                backoff: {
                    type: 'exponential',
                    delay: 2000,
                },
            });
            this.logger.debug(`Scheduled battle ${saved.id} to resolve in ${Math.max(0, delayMs)}ms`);
            nextStartTime = new Date(nextStartTime.getTime() + battleDurationMs);
        }
        this.logger.debug(`Queued ${newBattles.length} battles for character ${characterId}`);
        return [...currentQueue, ...newBattles];
    }
    /**
     * Simulate a single battle deterministically
     */
    async simulateBattle(character, monsterDef, gambitPage, seed) {
        const rng = new shared_1.Mulberry32(seed);
        // Fetch equipment stats (DEF, MDEF%, weaponFixedAtk, attribute bonuses)
        const equipmentStats = await this.equipmentService.calculateEquipmentStats(character.id);
        // Create character snapshot with equipment bonuses applied to attributes
        const characterSnapshot = {
            level: character.level,
            hpCurrent: character.hpCurrent,
            spCurrent: character.spCurrent,
            attributes: {
                str: character.str,
                agi: character.agi,
                dex: character.dex,
                vit: character.vit,
                int: character.int,
                sor: character.sor,
            },
            stats: shared_1.BattleEngine.calculateDerivedStats(character.level, {
                str: character.str + (equipmentStats.statBonus.STR || 0),
                agi: character.agi + (equipmentStats.statBonus.AGI || 0),
                dex: character.dex + (equipmentStats.statBonus.DEX || 0),
                vit: character.vit + (equipmentStats.statBonus.VIT || 0),
                int: character.int + (equipmentStats.statBonus.INT || 0),
                sor: character.sor + (equipmentStats.statBonus.SOR || 0),
            }, {
                def: equipmentStats.def,
                mdefPercent: equipmentStats.mdefPercent,
                weaponFixedAtk: equipmentStats.weaponFixedAtk,
                weaponFixedMatk: equipmentStats.weaponFixedMatk,
            }),
        };
        // Monster stats
        const monsterStats = shared_1.BattleEngine.calculateDerivedStats(monsterDef.level, {
            str: monsterDef.str || 5,
            agi: monsterDef.agi || 5,
            dex: monsterDef.dex || 5,
            vit: monsterDef.vit || 5,
            int: monsterDef.int || 5,
            sor: monsterDef.sor || 5,
        }, {});
        const log = [];
        let tick = 0;
        let charHp = characterSnapshot.stats.maxHp;
        let charSp = characterSnapshot.stats.maxSp;
        let monsterHp = monsterStats.maxHp;
        let charAttackGauge = 0;
        let monsterAttackGauge = 0;
        // Battle loop - max 60 ticks (~45 seconds)
        const MAX_TICKS = 60;
        let outcome = 'win';
        while (tick < MAX_TICKS && charHp > 0 && monsterHp > 0) {
            tick++;
            // Character attacks
            charAttackGauge += characterSnapshot.stats.accuracy / 10;
            if (charAttackGauge >= 100) {
                charAttackGauge -= 100;
                const hit = rng.nextPercent() < shared_1.BattleEngine.calculateHitChance(characterSnapshot.stats.accuracy, monsterStats.evasion);
                if (hit) {
                    let damage = characterSnapshot.stats.atk + rng.nextInt(-5, 5);
                    damage = shared_1.BattleEngine.calculatePhysicalDamage(damage, monsterStats.def);
                    const crit = rng.nextPercent() < characterSnapshot.stats.critChance;
                    if (crit) {
                        damage *= shared_1.BattleEngine.CRIT_MULTIPLIER;
                    }
                    monsterHp -= Math.max(1, Math.floor(damage));
                    log.push({
                        tick,
                        actor: 'character',
                        action: 'attack',
                        damage: Math.floor(damage),
                        crit,
                        monsterHpAfter: Math.max(0, monsterHp),
                    });
                }
                else {
                    log.push({
                        tick,
                        actor: 'character',
                        action: 'attack',
                        damage: 0,
                        crit: false,
                        miss: true,
                    });
                }
            }
            // Monster attacks
            monsterAttackGauge += monsterStats.accuracy / 10;
            if (monsterAttackGauge >= 100) {
                monsterAttackGauge -= 100;
                const hit = rng.nextPercent() < shared_1.BattleEngine.calculateHitChance(monsterStats.accuracy, characterSnapshot.stats.evasion);
                if (hit) {
                    let damage = monsterStats.atk + rng.nextInt(-3, 3);
                    damage = shared_1.BattleEngine.calculatePhysicalDamage(damage, characterSnapshot.stats.def);
                    const crit = rng.nextPercent() < monsterStats.critChance;
                    if (crit) {
                        damage *= shared_1.BattleEngine.CRIT_MULTIPLIER;
                    }
                    charHp -= Math.max(1, Math.floor(damage));
                    log.push({
                        tick,
                        actor: 'monster',
                        action: 'attack',
                        damage: Math.floor(damage),
                        crit,
                        characterHpAfter: Math.max(0, charHp),
                    });
                }
            }
            // Regeneration
            charHp = Math.min(characterSnapshot.stats.maxHp, charHp + characterSnapshot.stats.hpRegenPerTick);
            monsterHp = Math.min(monsterStats.maxHp, monsterHp + monsterStats.hpRegenPerTick);
        }
        if (charHp <= 0) {
            outcome = 'loss';
        }
        // Calculate rewards (only on win)
        let xpGain = 0;
        let goldGain = 0;
        const drops = [];
        if (outcome === 'win' && monsterHp <= 0) {
            xpGain = monsterDef.xpReward || 100;
            goldGain = monsterDef.goldReward || 50;
            // Process drops
            if (monsterDef.drops && Array.isArray(monsterDef.drops)) {
                for (const drop of monsterDef.drops) {
                    if (rng.nextPercent() < (drop.dropRate || 0) * 100) {
                        drops.push({
                            itemId: drop.itemId,
                            quantity: drop.quantity || 1,
                        });
                    }
                }
            }
        }
        return {
            outcome,
            log,
            tickCount: tick,
            xpGain,
            goldGain,
            drops,
            hpAfter: Math.max(1, charHp),
            spAfter: charSp,
        };
    }
    /**
     * Resolve a battle and apply rewards
     */
    async resolveBattle(battleId) {
        const battle = await this.battleQueueRepo.findOne({
            where: { id: battleId },
        });
        if (!battle)
            throw new common_1.NotFoundException('Battle not found');
        const character = await this.characterRepo.findOne({
            where: { id: battle.characterId },
        });
        if (!character)
            throw new Error('Character not found');
        // Apply results
        character.xp += battle.xpGain;
        character.gold = Math.min(1_000_000_000_000, Number(character.gold) + battle.goldGain);
        character.hpCurrent = Math.max(1, battle.hpAfter);
        character.spCurrent = battle.spAfter;
        // Check for level-ups
        let leveledUp = false;
        while (true) {
            const xpNeeded = this.dataService.getXpToNextLevel(character.level);
            if (character.xp >= xpNeeded) {
                character.level += 1;
                character.xp -= xpNeeded;
                character.unspentAttributePoints += 5;
                leveledUp = true;
                // Restore HP/SP on level-up
                const newStats = shared_1.BattleEngine.calculateDerivedStats(character.level, {
                    str: character.str,
                    agi: character.agi,
                    dex: character.dex,
                    vit: character.vit,
                    int: character.int,
                    sor: character.sor,
                }, {});
                character.hpCurrent = newStats.maxHp;
                character.spCurrent = newStats.maxSp;
            }
            else {
                break;
            }
        }
        // Handle death
        if (battle.outcome === 'loss') {
            await this.handleCharacterDeath(character, battle);
            // Emit death event
            await this.gatewayService.publishCharacterDied(character.id, {
                deathLog: character.lastDeathLog,
            });
            return; // Don't mark battle as resolved, handle separately
        }
        // Save character
        await this.characterRepo.save(character);
        // Process drops into inventory
        if (battle.drops && battle.drops.length > 0) {
            await this.inventoryService.processBattleDrops(character.id, battle.drops);
        }
        // Mark battle as resolved
        battle.resolved = true;
        await this.battleQueueRepo.save(battle);
        // Emit battle resolved event
        await this.gatewayService.publishBattleResolved(character.id, {
            entryId: battle.id,
            outcome: 'victory',
            xpGain: battle.xpGain,
            goldGain: battle.goldGain,
            drops: battle.drops || [],
            characterAfter: {
                id: character.id,
                level: character.level,
                xp: character.xp,
                hpCurrent: character.hpCurrent,
                spCurrent: character.spCurrent,
                gold: Number(character.gold),
                status: character.status,
            },
        });
        // Emit level-up event if applicable
        if (leveledUp) {
            await this.gatewayService.publishCharacterLeveledUp(character.id, {
                newLevel: character.level,
                unspentAttributePoints: character.unspentAttributePoints,
            });
        }
        this.logger.debug(`Resolved battle ${battleId} for character ${character.id}`);
    }
    /**
     * Handle character death
     */
    async handleCharacterDeath(character, battle) {
        // Return to town
        character.status = 'town';
        character.currentMapId = undefined;
        character.hpCurrent = 1;
        // Apply XP loss (5% of next level requirement)
        const xpLoss = Math.floor(this.dataService.getXpToNextLevel(character.level) * 0.05);
        character.xp = Math.max(0, character.xp - xpLoss);
        // Store death log
        character.lastDeathLog = {
            monsterName: battle.monsterId,
            mapId: battle.mapId,
            timestamp: new Date(),
            log: battle.log,
        };
        await this.characterRepo.save(character);
        // Delete all unresolved battles for this character
        await this.battleQueueRepo.delete({
            characterId: character.id,
            resolved: false,
        });
        this.logger.debug(`Character ${character.id} died to ${battle.monsterId}`);
    }
    /**
     * Select next monster deterministically
     */
    async selectNextMonster(characterId, mapId) {
        // Get or create kill counter
        let counter = await this.mapKillCounterRepo.findOne({
            where: { characterId, mapId },
        });
        if (!counter) {
            counter = this.mapKillCounterRepo.create({
                characterId,
                mapId,
                epoch: 0,
                mapKillCount: 0,
                perMonsterKillCount: {},
            });
            counter = await this.mapKillCounterRepo.save(counter);
        }
        // Get monsters in map
        const monsters = this.dataService.getMonstersInMap(mapId);
        if (!monsters || monsters.length === 0) {
            throw new Error(`No monsters found in map ${mapId}`);
        }
        // Use deterministic PRNG
        const seed = `${characterId}:${mapId}:${counter.epoch}`;
        const rng = new shared_1.Mulberry32(seed);
        // Advance PRNG by kill count positions to ensure different monsters on sequence
        for (let i = 0; i < counter.mapKillCount % 100; i++) {
            rng.next();
        }
        const selectedMonster = rng.weightedPick(monsters);
        // Increment kill counter
        counter.mapKillCount += 1;
        if (!counter.perMonsterKillCount) {
            counter.perMonsterKillCount = {};
        }
        counter.perMonsterKillCount[selectedMonster.id] =
            (counter.perMonsterKillCount[selectedMonster.id] || 0) + 1;
        // Check for epoch rollover
        if (counter.mapKillCount >= 10000) {
            counter.epoch += 1;
            counter.mapKillCount = 0;
        }
        await this.mapKillCounterRepo.save(counter);
        return selectedMonster.id;
    }
};
exports.BattleService = BattleService;
exports.BattleService = BattleService = BattleService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_1.InjectQueue)('battle-queue')),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.BattleQueueEntry)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.Character)),
    __param(3, (0, typeorm_1.InjectRepository)(entities_1.MapKillCounter)),
    __param(4, (0, typeorm_1.InjectRepository)(entities_1.GambitPage)),
    __param(10, (0, common_1.Inject)(redis_provider_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [Object, typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService,
        character_service_1.CharacterService,
        inventory_service_1.InventoryService,
        equipment_service_1.EquipmentService,
        gateway_service_1.GatewayService,
        ioredis_1.Redis])
], BattleService);
//# sourceMappingURL=battle.service.js.map