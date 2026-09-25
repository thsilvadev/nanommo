import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { BattleQueueEntry, Character, MapKillCounter, GambitPage } from '@/database/entities';
import { DataService } from '../data/data.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { GatewayService } from '../gateway/gateway.service';
import { Redis } from 'ioredis';
export declare class BattleService {
    private readonly bullQueue;
    private readonly battleQueueRepo;
    private readonly characterRepo;
    private readonly mapKillCounterRepo;
    private readonly gambitPageRepo;
    private readonly dataService;
    private readonly characterService;
    private readonly inventoryService;
    private readonly equipmentService;
    private readonly gatewayService;
    private readonly redis;
    private readonly logger;
    private readonly QUEUE_DEPTH_TARGET;
    private readonly AVERAGE_BATTLE_DURATION_MS;
    constructor(bullQueue: Queue, battleQueueRepo: Repository<BattleQueueEntry>, characterRepo: Repository<Character>, mapKillCounterRepo: Repository<MapKillCounter>, gambitPageRepo: Repository<GambitPage>, dataService: DataService, characterService: CharacterService, inventoryService: InventoryService, equipmentService: EquipmentService, gatewayService: GatewayService, redis: Redis);
    /**
     * Get the current battle queue for a character
     */
    getBattleQueue(characterId: string, limit?: number): Promise<BattleQueueEntry[]>;
    /**
     * Get a single battle by ID
     */
    getBattleById(battleId: string): Promise<BattleQueueEntry | null>;
    /**
     * Queue multiple battles until reaching target depth
     */
    queueBattles(characterId: string, targetDepth?: number): Promise<BattleQueueEntry[]>;
    /**
     * Simulate a single battle deterministically
     */
    private simulateBattle;
    /**
     * Resolve a battle and apply rewards
     */
    resolveBattle(battleId: string): Promise<void>;
    /**
     * Handle character death
     */
    private handleCharacterDeath;
    /**
     * Select next monster deterministically
     */
    private selectNextMonster;
}
//# sourceMappingURL=battle.service.d.ts.map