import { BattleService } from './battle.service';
import { CharacterService } from '../character/character.service';
export declare class BattleController {
    private readonly battleService;
    private readonly characterService;
    constructor(battleService: BattleService, characterService: CharacterService);
    /**
     * Get battle queue for authenticated user's character
     */
    getQueue(req: any): Promise<import("../../database/entities").BattleQueueEntry[]>;
    /**
     * Queue battles for the character (fill up to target depth)
     */
    queueBattles(req: any): Promise<import("../../database/entities").BattleQueueEntry[]>;
    /**
     * Resolve a completed battle (called by scheduler)
     */
    resolveBattle(battleId: string): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=battle.controller.d.ts.map