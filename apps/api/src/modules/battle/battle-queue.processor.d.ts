import { Job } from 'bull';
import { BattleService } from './battle.service';
import { CharacterService } from '../character/character.service';
/**
 * BattleQueueProcessor - Handles delayed battle resolution via BullMQ
 * Scheduled jobs fire at battle.endAt timestamps and resolve outcomes
 */
export declare class BattleQueueProcessor {
    private battleService;
    private characterService;
    private readonly logger;
    constructor(battleService: BattleService, characterService: CharacterService);
    /**
     * Process 'resolve-battle' job
     * Runs when battle endAt timestamp is reached
     */
    resolveBattle(job: Job<{
        battleId: string;
    }>): Promise<{
        success: boolean;
        battleId: string;
    } | undefined>;
    /**
     * Process 'queue-battles' job
     * Generates 5 new battles for a character
     * Used on initial map entry or periodic top-up
     */
    queueBattles(job: Job<{
        characterId: string;
    }>): Promise<{
        success: boolean;
        characterId: string;
    }>;
    /**
     * Job completed handler - for logging/events
     */
    onCompleted(job: Job): void;
    /**
     * Job failed handler - logs failures
     */
    onFailed(job: Job, err: Error): void;
}
//# sourceMappingURL=battle-queue.processor.d.ts.map