import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BattleQueueEntry, Character, MapKillCounter, GambitPage, InventoryItem } from '@/database/entities';
import {
  BattleEngine,
  GambitEvaluator,
  Mulberry32,
  mulberry32Seed,
  rngForIndex,
  resolveRewards,
  type CombatantSnapshot,
} from '@nanommo/shared';
import { DataService } from '../data/data.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

/** SPEC §11.2: epoch rollover once the counter reaches this many kills. */
const EPOCH_ROLLOVER_AT = 10_000;

/** SPEC §7.1: 1 tick = 1 second of in-game time. */
const MS_PER_TICK = 1000;

@Injectable()
export class BattleService {
  private readonly logger = new Logger(BattleService.name);
  private readonly QUEUE_DEPTH_TARGET = 5;

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
    @InjectRepository(InventoryItem)
    private readonly inventoryItemRepo: Repository<InventoryItem>,
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

  // ===========================================================================
  //  Combatant state assembly
  // ===========================================================================

  /**
   * Flatten the character's live inventory into an itemId -> quantity map.
   * This is what the engine's `use_item` legality check reads (SPEC §7.3 step 3).
   */
  private async buildInventoryMap(characterId: string): Promise<Record<string, number>> {
    const items = await this.inventoryItemRepo.find({
      where: { characterId, location: 'inventory' },
    });
    const map: Record<string, number> = {};
    for (const row of items) {
      map[row.itemId] = (map[row.itemId] ?? 0) + row.quantity;
    }
    return map;
  }

  /**
   * SPEC §9.1: a skill is usable only if its weapon type is equipped AND
   * WeaponProficiency.level >= skill.unlockWeaponLevel.
   */
  private async buildSkillAvailability(characterId: string): Promise<{
    skills: Record<string, any>;
    skillDefs: Record<string, any>;
    weaponTypes: string[];
  }> {
    const equipped = await this.equipmentService.getEquipment(characterId);
    const equippedIds = new Set(equipped.map((e) => e.itemId));

    const weaponTypes: string[] = [];
    for (const slot of ['mainHand', 'offHand']) {
      const row = equipped.find((e) => e.slot === slot);
      if (!row) continue;
      const def = this.dataService.getItemById(row.itemId);
      if (def?.weaponType && !weaponTypes.includes(def.weaponType)) {
        weaponTypes.push(def.weaponType);
      }
    }
    void equippedIds;

    const proficiencies = await this.equipmentService.getWeaponProficiencyLevels(characterId);
    const skills: Record<string, any> = {};
    const skillDefs: Record<string, any> = {};

    for (const weaponType of weaponTypes) {
      const profLevel = proficiencies[weaponType] ?? 1;
      for (const skill of this.dataService.getSkillsForWeapon(weaponType)) {
        if (Number(skill.unlockWeaponLevel ?? 1) > profLevel) continue;
        skills[skill.id] = skill;
        skillDefs[skill.id] = skill;
      }
    }

    return { skills, skillDefs, weaponTypes };
  }

  /**
   * Build the real combatant snapshot handed to BattleEngine.simulateBattle().
   * Equipment bonuses, weapon proficiency and live inventory are all included.
   */
  async buildCharacterSnapshot(
    character: Character,
    hp: number,
    sp: number,
  ): Promise<CombatantSnapshot> {
    const equipmentStats = await this.equipmentService.calculateEquipmentStats(character.id);
    const { skills, skillDefs, weaponTypes } = await this.buildSkillAvailability(character.id);

    const derived = BattleEngine.calculateDerivedStats(
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
    );

    return {
      level: character.level,
      hp: Math.max(1, Math.min(hp, derived.maxHp)),
      sp: Math.max(0, Math.min(sp, derived.maxSp)),
      ...derived,
      skills,
      skillDefs,
      statusEffects: character.statusEffects ?? [],
      foodBuffTicksRemaining: 0,
      equippedWeaponTypes: weaponTypes,
    } as CombatantSnapshot;
  }

  /**
   * weaponBaseAttackTicks for the equipped weapon (SPEC §7.2). Falls back to
   * the skill_trees.json average when the character is unarmed.
   */
  private getWeaponBaseAttackTicks(weaponTypes: string[]): number {
    const table: Record<string, number> = this.dataService.getWeaponBaseAttackTicks();
    for (const wt of weaponTypes) {
      if (table[wt]) return table[wt];
    }
    const values = Object.values(table);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 6;
  }

  // ===========================================================================
  //  Queue generation
  // ===========================================================================

  /**
   * Queue multiple battles until reaching target depth.
   *
   * SPEC §7.4: the next N battles are simulated in one shot, each chained from
   * the previous one's hp/sp/inventory state. Rewards (xp/gold/drops) are rolled
   * here but only APPLIED at resolve time by the BullMQ job.
   */
  async queueBattles(
    characterId: string,
    targetDepth: number = this.QUEUE_DEPTH_TARGET,
  ): Promise<BattleQueueEntry[]> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    if (!character.currentMapId) {
      throw new BadRequestException('Character is not on a map');
    }

    const currentQueue = await this.getBattleQueue(characterId, 100);
    if (currentQueue.length >= targetDepth) {
      return currentQueue; // Already at target depth
    }

    const mapId = character.currentMapId;
    const battlesToAdd = targetDepth - currentQueue.length;
    const newBattles: BattleQueueEntry[] = [];

    const maxSequenceIndex =
      currentQueue.length > 0 ? Math.max(...currentQueue.map((b) => b.sequenceIndex)) : -1;

    // SPEC §7.4: battle N+1 starts from battle N's end state.
    let chainHp = character.hpCurrent;
    let chainSp = character.spCurrent;
    const workingInventory = await this.buildInventoryMap(characterId);
    for (const pending of currentQueue) {
      chainHp = pending.hpAfter;
      chainSp = pending.spAfter;
      // pending potion consumption is not in the DB until each one resolves
      for (const consumed of pending.itemsConsumed ?? []) {
        workingInventory[consumed.itemId] = Math.max(
          0,
          (workingInventory[consumed.itemId] ?? 0) - consumed.quantity,
        );
      }
    }

    const gambitPage = character.activeGambitPageId
      ? await this.gambitPageRepo.findOne({ where: { id: character.activeGambitPageId } })
      : null;

    const counter = await this.getOrCreateKillCounter(characterId, mapId);
    const monsters = this.dataService.getMonstersInMap(mapId);
    if (!monsters || monsters.length === 0) {
      throw new Error(`No monsters found in map ${mapId}`);
    }

    const monsterSkillDefs = Object.fromEntries(
      this.dataService.getMonsterSkills().map((s: any) => [s.id, s]),
    );
    const itemDefinitions = Object.fromEntries(
      (this.dataService.getItems()?.consumables ?? []).map((c: any) => [c.id, c]),
    );

    // SPEC §11.2: seed = mulberry32Seed(`${characterId}:${mapId}:${epoch}`)
    const encounterSeed = mulberry32Seed(`${characterId}:${mapId}:${counter.epoch}`);

    // PROJECTED per-monster kill counts: the DB counter is only bumped on
    // resolve, but we need a distinct drop index for each battle in this batch.
    let projectedMapKillCount = counter.mapKillCount;
    const projectedPerMonster = { ...(counter.perMonsterKillCount ?? {}) };

    let nextStartTime =
      currentQueue.length > 0
        ? new Date(currentQueue[currentQueue.length - 1].endAt)
        : new Date();

    for (let i = 0; i < battlesToAdd; i++) {
      const sequenceIndex = maxSequenceIndex + 1 + i;
      const killIndex = projectedMapKillCount;

      // SPEC §11.2: nextMonsterId(mapId, mapKillCount) = weightedPick(rngForIndex(mapKillCount))
      const monster = rngForIndex(encounterSeed, killIndex).weightedPick(monsters);
      const monsterId = monster.id;

      const snapshot = await this.buildCharacterSnapshot(character, chainHp, chainSp);
      const seed = `${characterId}:${mapId}:${monsterId}:${sequenceIndex}:${counter.epoch}:${killIndex}`;

      // ---- Gambit is evaluated INSIDE the engine, per gauge fire (SPEC §7.3)
      const simulation = BattleEngine.simulateBattle(snapshot, monster, gambitPage, seed, {
        inventory: workingInventory,
        itemDefinitions,
        monsterSkillDefs,
        weaponBaseAttackTicks: this.getWeaponBaseAttackTicks(
          (snapshot as any).equippedWeaponTypes ?? [],
        ),
      });

      chainHp = simulation.hpAfter;
      chainSp = simulation.spAfter;
      Object.assign(workingInventory, simulation.inventoryAfter);

      // ---- Rewards: xp from xpReward, gold rolled from goldReward.min/max,
      //      drops from monsters.json chances (SPEC §11.5) - only on a win.
      const rewards = resolveRewards({
        monster,
        mapId,
        outcome: simulation.outcome,
        items: this.dataService.getItems(),
        killIndex: projectedPerMonster[monsterId] ?? 0,
        seed,
      });

      projectedMapKillCount += 1;
      projectedPerMonster[monsterId] = (projectedPerMonster[monsterId] ?? 0) + 1;

      const battleDurationMs = Math.max(1000, simulation.durationTicks * MS_PER_TICK);

      const entry = this.battleQueueRepo.create({
        characterId,
        sequenceIndex,
        mapId,
        monsterId,
        startAt: new Date(nextStartTime),
        endAt: new Date(nextStartTime.getTime() + battleDurationMs),
        outcome: simulation.outcome,
        log: { ...simulation.log, mapId },
        itemsConsumed: simulation.itemsConsumed,
        xpGain: rewards.xpGain,
        goldGain: rewards.goldGain,
        drops: rewards.drops,
        hpAfter: simulation.hpAfter,
        spAfter: simulation.spAfter,
        resolved: false,
        seedUsed: seed,
      });

      const saved = await this.battleQueueRepo.save(entry);
      newBattles.push(saved);

      const delayMs = saved.endAt.getTime() - Date.now();
      await this.bullQueue.add(
        'resolve-battle',
        { battleId: saved.id },
        {
          delay: Math.max(0, delayMs),
          jobId: saved.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );

      this.logger.log(
        `Queued battle seq=${sequenceIndex} char=${characterId} ${monsterId} ` +
          `outcome=${simulation.outcome} ticks=${simulation.durationTicks} ` +
          `hpAfter=${simulation.hpAfter} xp=${rewards.xpGain} gold=${rewards.goldGain} ` +
          `drops=${rewards.drops.length} itemsConsumed=${simulation.itemsConsumed.length} ` +
          `resolvesIn=${Math.max(0, delayMs)}ms`,
      );

      nextStartTime = new Date(nextStartTime.getTime() + battleDurationMs);
    }

    return [...currentQueue, ...newBattles];
  }

  // ===========================================================================
  //  Resolve (runs from the BullMQ delayed job)
  // ===========================================================================

  /**
   * Resolve a battle and apply its effects. This is the ONLY place where
   * xp / gold / drops / consumed items / the kill counter actually mutate.
   */
  async resolveBattle(battleId: string): Promise<void> {
    const battle = await this.battleQueueRepo.findOne({ where: { id: battleId } });
    if (!battle) throw new NotFoundException('Battle not found');

    const character = await this.characterRepo.findOne({
      where: { id: battle.characterId },
    });
    if (!character) throw new Error('Character not found');

    // Items were spent during the simulation - they leave the real inventory now.
    for (const consumed of battle.itemsConsumed ?? []) {
      const have = await this.inventoryService.getItemCount(character.id, consumed.itemId);
      const take = Math.min(have, consumed.quantity);
      if (take > 0) {
        await this.inventoryService.removeItem(character.id, consumed.itemId, take);
      }
    }

    if (battle.outcome === 'loss') {
      await this.handleCharacterDeath(character, battle);
      return;
    }

    // --- XP: the monster's xpReward, already rolled at simulation time
    character.xp = Number(character.xp) + Number(battle.xpGain ?? 0);

    // --- Gold: goldReward.min/max was already rolled with Mulberry32
    character.gold = Math.min(
      1_000_000_000_000,
      Number(character.gold) + Number(battle.goldGain ?? 0),
    );

    character.hpCurrent = Math.max(1, battle.hpAfter);
    character.spCurrent = Math.max(0, battle.spAfter);

    // --- level ups
    let leveledUp = false;
    for (;;) {
      const xpNeeded = this.dataService.getXpToNextLevel(character.level);
      if (xpNeeded <= 0 || Number(character.xp) < xpNeeded) break;
      character.xp = Number(character.xp) - xpNeeded;
      character.level += 1;
      character.unspentAttributePoints += 5;
      leveledUp = true;
    }
    if (leveledUp) {
      const fresh = await this.buildCharacterSnapshot(
        character,
        character.hpCurrent,
        character.spCurrent,
      );
      character.hpCurrent = fresh.maxHp;
      character.spCurrent = fresh.maxSp;
    }

    await this.characterRepo.save(character);

    // --- drops (SPEC §11.5)
    if (Array.isArray(battle.drops) && battle.drops.length > 0) {
      for (const drop of battle.drops) {
        try {
          await this.inventoryService.addItem(
            character.id,
            drop.itemId,
            drop.quantity ?? 1,
            'inventory',
            drop.instanceData,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to add drop ${drop.itemId} to ${character.id}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }

    // --- the kill actually happened: bump the counter (SPEC §11.2)
    const killCounter = await this.incrementKillCounter(character.id, battle.mapId, battle.monsterId);

    battle.resolved = true;
    await this.battleQueueRepo.save(battle);

    this.logger.log(
      `Resolved battle ${battle.id} char=${character.id} ${battle.monsterId} ` +
        `xp+=${battle.xpGain} gold+=${battle.goldGain} drops=${JSON.stringify(battle.drops)} ` +
        `level=${character.level} xp=${character.xp} gold=${character.gold} ` +
        `mapKillCount=${killCounter.mapKillCount} perMonster=${battle.monsterId}:${killCounter.perMonsterCount}`,
    );
  }

  /**
   * Handle character death (SPEC §7.6)
   */
  private async handleCharacterDeath(character: Character, battle: BattleQueueEntry): Promise<void> {
    // Consumed items are still gone, and the character is routed to town.
    character.status = 'town';
    // null, not undefined: TypeORM silently skips undefined columns on save,
    // which would leave the character on a map it is no longer standing on.
    character.currentMapId = null as any;
    character.hpCurrent = 1;

    // SPEC §6.4 XP loss: 5% of the next level requirement
    const xpLoss = Math.floor(this.dataService.getXpToNextLevel(character.level) * 0.05);
    character.xp = Math.max(0, Number(character.xp) - xpLoss);

    // SPEC §7.7: lastDeathLog is overwritten with this battle's full log
    character.lastDeathLog = {
      monsterId: battle.monsterId,
      mapId: battle.mapId,
      timestamp: new Date().toISOString(),
      log: battle.log,
    };

    await this.characterRepo.save(character);

    // Everything still queued assumed the character survived
    const doomed = await this.battleQueueRepo.find({
      where: { characterId: character.id, resolved: false },
    });
    if (doomed.length) {
      await this.battleQueueRepo.delete({ id: In(doomed.map((b) => b.id)) });
      for (const entry of doomed) {
        await this.bullQueue
          .getJob(entry.id)
          .then((job) => job?.remove())
          .catch(() => undefined);
      }
    }

    this.logger.log(
      `Character ${character.id} died to ${battle.monsterId}; ` +
        `${doomed.length} queued battle(s) discarded`,
    );
  }

  // ===========================================================================
  //  MapKillCounter (SPEC §11.2)
  // ===========================================================================

  private async getOrCreateKillCounter(characterId: string, mapId: string): Promise<MapKillCounter> {
    let counter = await this.mapKillCounterRepo.findOne({ where: { characterId, mapId } });
    if (!counter) {
      counter = await this.mapKillCounterRepo.save(
        this.mapKillCounterRepo.create({
          characterId,
          mapId,
          epoch: 0,
          mapKillCount: 0,
          perMonsterKillCount: {},
        }),
      );
    }
    return counter;
  }

  /**
   * SPEC §11.2 epoch rollover: when mapKillCount (or a given monster's
   * perMonsterKillCount) reaches 10,000, increment epoch and reset the counter.
   * The seed incorporates epoch, so the sequence "feels" fresh.
   *
   * Called from resolveBattle only - one increment per actually resolved kill.
   */
  async incrementKillCounter(
    characterId: string,
    mapId: string,
    monsterId: string,
  ): Promise<{ mapKillCount: number; perMonsterCount: number; epoch: number }> {
    const counter = await this.getOrCreateKillCounter(characterId, mapId);

    counter.mapKillCount = Number(counter.mapKillCount ?? 0) + 1;

    const perMonster = { ...(counter.perMonsterKillCount ?? {}) };
    perMonster[monsterId] = Number(perMonster[monsterId] ?? 0) + 1;
    counter.perMonsterKillCount = perMonster;

    if (counter.mapKillCount >= EPOCH_ROLLOVER_AT) {
      counter.epoch = Number(counter.epoch ?? 0) + 1;
      counter.mapKillCount = 0;
      this.logger.log(
        `MapKillCounter epoch rollover for ${characterId}/${mapId} -> epoch ${counter.epoch}`,
      );
    }

    await this.mapKillCounterRepo.save(counter);

    return {
      mapKillCount: Number(counter.mapKillCount),
      perMonsterCount: Number(perMonster[monsterId] ?? 0),
      epoch: Number(counter.epoch ?? 0),
    };
  }

  /**
   * Read the kill counter without touching it (diagnostics / the map endpoint)
   */
  async getKillCounter(characterId: string, mapId: string): Promise<MapKillCounter | null> {
    return this.mapKillCounterRepo.findOne({ where: { characterId, mapId } });
  }
}
