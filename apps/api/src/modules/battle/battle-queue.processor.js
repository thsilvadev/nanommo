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
var BattleQueueProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleQueueProcessor = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const battle_service_1 = require("./battle.service");
const character_service_1 = require("../character/character.service");
/**
 * BattleQueueProcessor - Handles delayed battle resolution via BullMQ
 * Scheduled jobs fire at battle.endAt timestamps and resolve outcomes
 */
let BattleQueueProcessor = BattleQueueProcessor_1 = class BattleQueueProcessor {
    battleService;
    characterService;
    logger = new common_1.Logger(BattleQueueProcessor_1.name);
    constructor(battleService, characterService) {
        this.battleService = battleService;
        this.characterService = characterService;
    }
    /**
     * Process 'resolve-battle' job
     * Runs when battle endAt timestamp is reached
     */
    async resolveBattle(job) {
        const { battleId } = job.data;
        try {
            this.logger.debug(`Resolving battle ${battleId}`);
            // Resolve the battle (apply XP, gold, drops, level-ups, death handling)
            await this.battleService.resolveBattle(battleId);
            // After resolution, fetch the resolved battle to get character ID
            const battle = await this.battleService.getBattleById(battleId);
            if (!battle) {
                this.logger.warn(`Battle ${battleId} not found after resolution`);
                return;
            }
            const character = await this.characterService.getCharacterById(battle.characterId);
            if (character && character.status === 'grinding' && character.currentMapId) {
                // Get current queue depth
                const queue = await this.battleService.getBattleQueue(battle.characterId, 100);
                const unresolvedCount = queue.filter((b) => !b.resolved).length;
                // If queue depth < 5, queue more battles
                if (unresolvedCount < 5) {
                    this.logger.debug(`Queue depth ${unresolvedCount} < 5, generating new battles for character ${character.id}`);
                    await this.battleService.queueBattles(battle.characterId, 5);
                }
            }
            this.logger.debug(`Battle ${battleId} resolved successfully`);
            return { success: true, battleId };
        }
        catch (error) {
            this.logger.error(`Failed to resolve battle ${battleId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Throw to trigger retry
            throw error;
        }
    }
    /**
     * Process 'queue-battles' job
     * Generates 5 new battles for a character
     * Used on initial map entry or periodic top-up
     */
    async queueBattles(job) {
        const { characterId } = job.data;
        try {
            this.logger.debug(`Queueing battles for character ${characterId}`);
            await this.battleService.queueBattles(characterId, 5);
            this.logger.debug(`Queued 5 new battles for character ${characterId}`);
            return { success: true, characterId };
        }
        catch (error) {
            this.logger.error(`Failed to queue battles for character ${characterId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }
    /**
     * Job completed handler - for logging/events
     */
    onCompleted(job) {
        this.logger.debug(`Job ${job.id} completed: ${job.name}`);
    }
    /**
     * Job failed handler - logs failures
     */
    onFailed(job, err) {
        this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`);
    }
};
exports.BattleQueueProcessor = BattleQueueProcessor;
__decorate([
    (0, bull_1.Process)('resolve-battle'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BattleQueueProcessor.prototype, "resolveBattle", null);
__decorate([
    (0, bull_1.Process)('queue-battles'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BattleQueueProcessor.prototype, "queueBattles", null);
exports.BattleQueueProcessor = BattleQueueProcessor = BattleQueueProcessor_1 = __decorate([
    (0, bull_1.Processor)('battle-queue'),
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [battle_service_1.BattleService,
        character_service_1.CharacterService])
], BattleQueueProcessor);
//# sourceMappingURL=battle-queue.processor.js.map