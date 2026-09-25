import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BattleQueueEntry, Character, MapKillCounter, GambitPage } from '@/database/entities';
import { BattleEngine, Mulberry32 } from '@nanommo/shared';
import { DataService } from '../data/data.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

@Injectable()
export class BattleService {
  private readonly logger = new Logger(BattleService.name);
  private readonly QUEUE_DEPTH_TARGET = 5;
  private readonly AVERAGE_BATTLE_DURATION_MS = 15000; // 15 seconds average

  constructor(
    @InjectQueue('battle-queue')
    private readonly bullQueue: Queue,
    @InjectRepository(BattleQueueEntry)
    private readonly battleQueueRepo: Repository<BattleQueueEntry>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectRepository(MapKillCounter)
    private readonly mapKillCounterRepo: Repository<MapKillCounter>,
    @InjectRepository(GambitPage)
    private readonly gambitPageRepo: Repository<GambitPage>,
    private readonly dataService: DataService,
    private readonly characterService: CharacterService,
    private readonly inventoryService: InventoryService,
    private readonly equipmentService: EquipmentService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Get the current battle queue for a character
   */
  async getBattleQueue(characterId: string, limit: number = 5): Promise<BattleQueueEntry[]> {
    return this.battleQueueRepo.find({
      where: { characterId, resolved: false },
      order: { sequenceIndex: 'ASC' },
      take: limit,
    });
  }

  /**
   * Get a single battle by ID
   */
  async getBattleById(battleId: string): Promise<BattleQueueEntry | null> {
    return this.battleQueueRepo.findOne({
      where: { id: battleId },
    });
  }

  /**
   * Queue multiple battles until reaching target depth
   */
  async queueBattles(characterId: string, targetDepth: number = this.QUEUE_DEPTH_TARGET): Promise<BattleQueueEntry[]> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    if (!character.currentMapId) {
      throw new BadRequestException('Character is not on a map');
    }

    // Get current queue depth
    const currentQueue = await this.getBattleQueue(characterId, targetDepth);
    const queueDepth = currentQueue.length;

    if (queueDepth >= targetDepth) {
      return currentQueue; // Already at target depth
    }

    const battlesToAdd = targetDepth - queueDepth;
    const newBattles: BattleQueueEntry[] = [];

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
      if (!monsterDef) throw new Error('Monster not found');

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
      await this.bullQueue.add(
        'resolve-battle',
        { battleId: saved.id },
        {
          delay: Math.max(0, delayMs), // Ensure positive delay
          jobId: saved.id, // Prevent duplicates
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      );

      this.logger.debug(`Scheduled battle ${saved.id} to resolve in ${Math.max(0, delayMs)}ms`);

      nextStartTime = new Date(nextStartTime.getTime() + battleDurationMs);
    }

    this.logger.debug(`Queued ${newBattles.length} battles for character ${characterId}`);
    return [...currentQueue, ...newBattles];
  }

  /**
   * Simulate a single battle deterministically
   */
  private async simulateBattle(
    character: Character,
    monsterDef: any,
    gambitPage: GambitPage | null,
    seed: string,
  ): Promise<any> {
    const rng = new Mulberry32(seed);

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
      stats: BattleEngine.calculateDerivedStats(
        character.level,
        {
          str: character.str + (equipmentStats.statBonus.STR || 0),
          agi: character.agi + (equipmentStats.statBonus.AGI || 0),
          dex: character.dex + (equipmentStats.statBonus.DEX || 0),
          vit: character.vit + (equipmentStats.statBonus.VIT || 0),
          int: character.int + (equipmentStats.statBonus.INT || 0),
          sor: character.sor + (equipmentStats.statBonus.SOR || 0),
        },
        {
          def: equipmentStats.def,
          mdefPercent: equipmentStats.mdefPercent,
          weaponFixedAtk: equipmentStats.weaponFixedAtk,
          weaponFixedMatk: equipmentStats.weaponFixedMatk,
        },
      ),
    };

    // Monster stats
    const monsterStats = BattleEngine.calculateDerivedStats(monsterDef.level, {
      str: monsterDef.str || 5,
      agi: monsterDef.agi || 5,
      dex: monsterDef.dex || 5,
      vit: monsterDef.vit || 5,
      int: monsterDef.int || 5,
      sor: monsterDef.sor || 5,
    }, {});

    const log: any[] = [];
    let tick = 0;
    let charHp = characterSnapshot.stats.maxHp;
    let charSp = characterSnapshot.stats.maxSp;
    let monsterHp = monsterStats.maxHp;
    let charAttackGauge = 0;
    let monsterAttackGauge = 0;

    // Battle loop - max 60 ticks (~45 seconds)
    const MAX_TICKS = 60;
    let outcome: 'win' | 'loss' = 'win';

    while (tick < MAX_TICKS && charHp > 0 && monsterHp > 0) {
      tick++;

      // Character attacks
      charAttackGauge += characterSnapshot.stats.accuracy / 10;
      if (charAttackGauge >= 100) {
        charAttackGauge -= 100;
        const hit = rng.nextPercent() < BattleEngine.calculateHitChance(
          characterSnapshot.stats.accuracy,
          monsterStats.evasion,
        );

        if (hit) {
          let damage = characterSnapshot.stats.atk + rng.nextInt(-5, 5);
          damage = BattleEngine.calculatePhysicalDamage(damage, monsterStats.def);
          
          const crit = rng.nextPercent() < characterSnapshot.stats.critChance;
          if (crit) {
            damage *= BattleEngine.CRIT_MULTIPLIER;
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
        } else {
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
        const hit = rng.nextPercent() < BattleEngine.calculateHitChance(
          monsterStats.accuracy,
          characterSnapshot.stats.evasion,
        );

        if (hit) {
          let damage = monsterStats.atk + rng.nextInt(-3, 3);
          damage = BattleEngine.calculatePhysicalDamage(damage, characterSnapshot.stats.def);
          
          const crit = rng.nextPercent() < monsterStats.critChance;
          if (crit) {
            damage *= BattleEngine.CRIT_MULTIPLIER;
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
    const drops: any[] = [];

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
  async resolveBattle(battleId: string): Promise<void> {
    const battle = await this.battleQueueRepo.findOne({
      where: { id: battleId },
    });

    if (!battle) throw new NotFoundException('Battle not found');

    const character = await this.characterRepo.findOne({
      where: { id: battle.characterId },
    });
    if (!character) throw new Error('Character not found');

    // Apply results
    character.xp += battle.xpGain;
    character.gold = Math.min(
      1_000_000_000_000,
      Number(character.gold) + battle.goldGain,
    );
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
        const newStats = BattleEngine.calculateDerivedStats(character.level, {
          str: character.str,
          agi: character.agi,
          dex: character.dex,
          vit: character.vit,
          int: character.int,
          sor: character.sor,
        }, {});
        character.hpCurrent = newStats.maxHp;
        character.spCurrent = newStats.maxSp;
      } else {
        break;
      }
    }

    // Handle death
    if (battle.outcome === 'loss') {
      await this.handleCharacterDeath(character, battle);
      
      // TODO: Emit death event via gateway
      // await this.gatewayService.publishCharacterDied(character.id, {
      //   deathLog: character.lastDeathLog,
      // });
      
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

    // TODO: Emit battle resolved event via gateway
    // await this.gatewayService.publishBattleResolved(character.id, {
    //   entryId: battle.id,
    //   outcome: 'victory',
    //   xpGain: battle.xpGain,
    //   goldGain: battle.goldGain,
    //   drops: battle.drops || [],
    //   characterAfter: {
    //     id: character.id,
    //     level: character.level,
    //     xp: character.xp,
    //     hpCurrent: character.hpCurrent,
    //     spCurrent: character.spCurrent,
    //     gold: Number(character.gold),
    //     status: character.status,
    //   },
    // });

    // Emit level-up event if applicable
    if (leveledUp) {
      // TODO: Emit level up event via gateway
      // await this.gatewayService.publishCharacterLeveledUp(character.id, {
      //   newLevel: character.level,
      //   unspentAttributePoints: character.unspentAttributePoints,
      // });
    }

    this.logger.debug(`Resolved battle ${battleId} for character ${character.id}`);
  }

  /**
   * Handle character death
   */
  private async handleCharacterDeath(
    character: Character,
    battle: BattleQueueEntry,
  ): Promise<void> {
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
  private async selectNextMonster(characterId: string, mapId: string): Promise<string> {
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
    const rng = new Mulberry32(seed);
    
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
}
