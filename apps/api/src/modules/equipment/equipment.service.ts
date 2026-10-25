import { Injectable, BadRequestException, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { EquippedItem } from '../../database/entities/equipped-item.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { WeaponProficiency } from '../../database/entities/weapon-proficiency.entity';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { DataService } from '../data/data.service';
import { BattleEngine, effectiveWeaponAttack, validateHandLoadout, sumAttributeBonuses, applyAttributeBonuses } from '@nanommo/shared';
import { BattleService } from '../battle/battle.service';
import { createHash } from 'crypto';
import { effectiveItemDefinition, refinementLevel, resolveRefinementFailure, rolledStatValue } from '@nanommo/shared';

export interface EquipmentStats {
  def: number;
  mdefPercent: number;
  maxHp: number;
  maxSp: number;
  weaponFixedAtk: number;
  weaponFixedMatk: number;
  accuracyModifier: number;
  evasionModifier: number;
  criticalChanceModifier: number;
  attackSpeedModifier: number;
  castTimeReductionModifier: number;
  accuracyMultiplier: number;
  statBonus: {
    STR?: number;
    AGI?: number;
    DEX?: number;
    VIT?: number;
    INT?: number;
    LUK?: number;
  };
}

export interface DerivedStats {
  maxHp: number;
  maxSp: number;
  atk: number;
  matk: number;
  def: number;
  mdefPercent: number;
  accuracy: number;
  evasion: number;
  critChance: number;
  hpRegenPerTenTicks: number;
  spRegenPerTenTicks: number;
}

@Injectable()
export class EquipmentService {
  private readonly logger = new Logger('EquipmentService');

  constructor(
    @InjectRepository(EquippedItem)
    private readonly equippedItemRepo: Repository<EquippedItem>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectRepository(WeaponProficiency)
    private readonly weaponProfRepo: Repository<WeaponProficiency>,
    @InjectRepository(InventoryItem)
    private readonly inventoryItemRepo: Repository<InventoryItem>,
    @InjectRepository(BattleQueueEntry)
    private readonly battleQueueRepo: Repository<BattleQueueEntry>,
    private readonly dataService: DataService,
    @Inject(forwardRef(() => BattleService))
    private readonly battleService: BattleService,
  ) {}

  /**
   * All equipped items for a character
   */
  async getEquipment(characterId: string, manager?: EntityManager): Promise<EquippedItem[]> {
    const repo = manager?.getRepository(EquippedItem) ?? this.equippedItemRepo;
    return repo.find({
      where: { characterId },
    });
  }

  /**
   * Weapon proficiency level per weapon type (SPEC §9.1).
   * A weapon type the character has never trained defaults to level 1.
   */
  async getWeaponProficiencyLevels(characterId: string): Promise<Record<string, number>> {
    const rows = await this.weaponProfRepo.find({ where: { characterId } });
    const levels: Record<string, number> = {};
    for (const row of rows) {
      levels[row.weaponType] = Number(row.level ?? 0);
    }
    return levels;
  }

  /** Server-authoritative Mastery state used when building immutable battle snapshots. */
  async getWeaponMasteryRows(characterId: string): Promise<Array<{ weaponType: string; level: number; xp: number; spentSkillPoints: number; skillRanks: Record<string, number> }>> {
    const rows = await this.weaponProfRepo.find({ where: { characterId } });
    return rows.map((row) => ({
      weaponType: row.weaponType,
      level: Number(row.level ?? 0),
      xp: Number(row.xp ?? 0),
      spentSkillPoints: Number(row.spentSkillPoints ?? 0),
      skillRanks: row.skillRanks ?? {},
    }));
  }


  /**
   * Get item equipped in a specific slot
   */
  async getEquippedInSlot(
    characterId: string,
    slot: string,
    manager?: EntityManager,
  ): Promise<EquippedItem | null> {
    const repo = manager?.getRepository(EquippedItem) ?? this.equippedItemRepo;
    return repo.findOne({
      where: { characterId, slot },
    });
  }

  /**
   * Calculate total equipment stats (DEF, MDEF%, attribute bonuses)
   * Used in character stats calculation
   */
  async calculateEquipmentStats(characterId: string, manager?: EntityManager): Promise<EquipmentStats> {
    const equipped = await this.getEquipment(characterId, manager);
    const stats: EquipmentStats = {
      def: 0,
      mdefPercent: 0,
      maxHp: 0,
      maxSp: 0,
      weaponFixedAtk: 0,
      weaponFixedMatk: 0,
      accuracyModifier: 0,
      evasionModifier: 0,
      criticalChanceModifier: 0,
      attackSpeedModifier: 0,
      castTimeReductionModifier: 0,
      accuracyMultiplier: 1,
      statBonus: {
        STR: 0,
        AGI: 0,
        DEX: 0,
        VIT: 0,
        INT: 0,
        LUK: 0,
      },
    };

    for (const equip of equipped) {
      const baseItemDef = this.dataService.getItemById(equip.itemId);
      if (!baseItemDef || baseItemDef.type !== 'equipment') continue;
      const itemDef = effectiveItemDefinition(baseItemDef, equip.instanceData);

      // Add fixed stats
      stats.def += Number(itemDef.fixedStats?.def ?? 0);
      stats.mdefPercent += Number(itemDef.fixedStats?.mdefPercent ?? 0);
      stats.maxHp += Number(itemDef.fixedStats?.maxHp ?? 0);
      stats.maxSp += Number(itemDef.fixedStats?.maxSp ?? 0);

      // Add stat bonuses from fixed stats
      if (itemDef.fixedStats?.statBonus) {
        const statBonusObj = itemDef.fixedStats.statBonus;
        for (const [attr, bonus] of Object.entries(statBonusObj)) {
          const attrKey = attr as keyof typeof stats.statBonus;
          if (attrKey in stats.statBonus && typeof bonus === 'number') {
            stats.statBonus[attrKey] = (stats.statBonus[attrKey] || 0) + bonus;
          }
        }
      }

      // Add random roll bonus if present
      if (equip.instanceData?.rolledAttribute && equip.instanceData?.rolledValue) {
        const attr = (String(equip.instanceData.rolledAttribute).toUpperCase() === 'SOR' ? 'LUK' : String(equip.instanceData.rolledAttribute).toUpperCase()) as keyof typeof stats.statBonus;
        if (stats.statBonus[attr] !== undefined) stats.statBonus[attr] += Number(equip.instanceData.rolledValue);
      }
      stats.maxHp += rolledStatValue(equip.instanceData, 'hp');
      stats.maxSp += rolledStatValue(equip.instanceData, 'sp');
      stats.def += rolledStatValue(equip.instanceData, 'defense');
      const rolledAtk = rolledStatValue(equip.instanceData, 'atk');
      stats.weaponFixedAtk += equip.slot === 'offHand' && itemDef.weaponType && !['shield', 'rune'].includes(String(itemDef.weaponType))
        ? Math.floor(rolledAtk / 2) : rolledAtk;
      if (equip.slot === 'mainHand') stats.weaponFixedMatk += rolledStatValue(equip.instanceData, 'matk');
      stats.accuracyModifier += rolledStatValue(equip.instanceData, 'accuracy');
      stats.evasionModifier += rolledStatValue(equip.instanceData, 'evasion');
      stats.criticalChanceModifier += rolledStatValue(equip.instanceData, 'criticalPercent');
      stats.attackSpeedModifier += rolledStatValue(equip.instanceData, 'atkSpeed');
      stats.castTimeReductionModifier += rolledStatValue(equip.instanceData, 'castTimeReduction');

      // Only weapon ATK is halved in the secondary hand. Other item properties
      // (including attribute and defensive bonuses) remain at full value.
      if (equip.slot === 'mainHand' || equip.slot === 'offHand') {
        stats.weaponFixedAtk += effectiveWeaponAttack(itemDef, equip.slot);
        if (equip.slot === 'mainHand') {
          stats.weaponFixedMatk += Number(itemDef.fixedStats?.matk ?? 0);
        }
      }
      if (itemDef.weaponType === 'bow') stats.accuracyMultiplier *= 0.5;
    }

    // Clamp MDEF% to 0-100 range
    stats.mdefPercent = Math.min(100, Math.max(0, stats.mdefPercent));

    return stats;
  }

  /**
   * Calculate derived stats for a character with current equipment
   */
  async calculateDerivedStats(character: Character): Promise<DerivedStats> {
    const equipStats = await this.calculateEquipmentStats(character.id);
    const attributes = applyAttributeBonuses(character, sumAttributeBonuses(equipStats.statBonus));
    return BattleEngine.calculateDerivedStats(character.level, attributes, equipStats);
  }

  private readonly refinementChances = [100, 100, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
  private readonly refinementStatGain: Record<string, number> = {
    atk: 5, matk: 5, defense: 4, hp: 10, sp: 10, atkSpeed: 10,
    castTimeReduction: 5, evasion: 3, accuracy: 3, criticalPercent: 1,
  };

  private assertRefinementLocation(character: Character): void {
    const map = this.dataService.getMapById(character.currentMapId);
    if (!map || map.type !== 'town' || !(map.npcIds ?? []).includes('whitesmith_spitz')
      || character.status !== 'town' || character.travelIntent || character.pendingMapTransition) {
      throw new BadRequestException('Equipment refinement is only available at Whitesmith Spitz in Caelum');
    }
  }

  async getRefinementPreview(characterId: string, inventoryItemId: string, useDivineShard = false): Promise<any> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    this.assertRefinementLocation(character);
    const row = await this.inventoryItemRepo.findOne({ where: { id: inventoryItemId, characterId, location: 'inventory' } });
    if (!row) throw new NotFoundException('Equipment instance not found in Inventory');
    const item = this.dataService.getItemById(row.itemId);
    if (!item || item.type !== 'equipment') throw new BadRequestException('Only equipment can be refined');
    const level = refinementLevel(row.instanceData);
    if (level >= 12) throw new BadRequestException('Equipment is already at the maximum refinement level (+12)');
    if (useDivineShard && (level < 6 || level > 11)) throw new BadRequestException('Divine Shards can only protect refinement attempts from +6 to +12');
    const rows = await this.inventoryItemRepo.find({ where: { characterId, location: 'inventory' } });
    const count = (id: string) => rows.filter(x => x.itemId === id).reduce((sum, x) => sum + Number(x.quantity), 0);
    const nextLevel = level + 1;
    const failure = level <= 2 ? 'No failure at this chance' : level <= 5
      ? 'The Bliss Stone is lost; equipment refinement stays unchanged'
      : level <= 8 ? (useDivineShard ? 'The Bliss Stone and Divine Shard are lost; refinement stays unchanged' : 'The Bliss Stone is lost; refinement resets to +0')
      : (useDivineShard ? 'The Bliss Stone and Divine Shard are lost; refinement decreases by one' : 'The equipment is destroyed');
    const directStats = ['atk', 'matk', 'def', 'mdefPercent'].filter(key => item.fixedStats?.[key] !== undefined && item.fixedStats?.[key] !== null && Number(item.fixedStats[key]) !== 0)
      .map(key => ({ stat: key, current: Number(item.fixedStats[key]) + Number(item.fixedStats[key] !== 0 ? 3 * level : 0), increase: 3 }));
    const rolledStat = String(row.instanceData?.rolledStat ?? '');
    const rolledAttribute = String(row.instanceData?.rolledAttribute ?? '');
    return {
      inventoryItemId: row.id, itemId: row.itemId, itemName: item.name, refinementLevel: level, nextRefinementLevel: nextLevel,
      chancePercent: this.refinementChances[level], useDivineShard, hasBlissStone: count('mat_bliss_stone') > 0,
      hasDivineShard: count('mat_divine_shard') > 0, canAttempt: count('mat_bliss_stone') > 0 && (!useDivineShard || (level >= 6 && level <= 11 && count('mat_divine_shard') > 0)),
      failureEffect: failure, directStats,
      rolledBonus: nextLevel > 6 ? (rolledAttribute && row.instanceData?.craftedByProfession ? { type: 'attribute', stat: rolledAttribute, increase: 2 } :
        rolledStat ? { type: 'stat', stat: rolledStat, increase: this.refinementStatGain[rolledStat] ?? 0 } : null) : null,
      currentRolledValue: rolledAttribute ? Number(row.instanceData?.rolledValue ?? 0) : rolledStat ? Number(row.instanceData?.rolledStatValue ?? 0) : 0,
    };
  }

  async refineItem(characterId: string, inventoryItemId: string, useDivineShard = false): Promise<any> {
    return this.battleService.runFutureCombatMutation(characterId, () =>
      this.inventoryItemRepo.manager.transaction(async manager => {
        const characterRepo = manager.getRepository(Character);
        const invRepo = manager.getRepository(InventoryItem);
        const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
        if (!character) throw new NotFoundException('Character not found');
        this.assertRefinementLocation(character);
        const row = await invRepo.findOne({ where: { id: inventoryItemId, characterId, location: 'inventory' }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new NotFoundException('Equipment instance not found in Inventory');
        const item = this.dataService.getItemById(row.itemId);
        if (!item || item.type !== 'equipment' || row.quantity !== 1) throw new BadRequestException('Select one equipment instance to refine');
        const instanceData = { ...(row.instanceData ?? {}) };
        const level = refinementLevel(instanceData);
        if (level >= 12) throw new BadRequestException('Equipment is already at the maximum refinement level (+12)');
        if (useDivineShard && (level < 6 || level > 11)) throw new BadRequestException('Divine Shards can only be used for attempts +6→+7 through +11→+12');
        const materialRows = await invRepo.find({ where: { characterId, location: 'inventory' }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
        const consumeOne = async (itemId: string) => {
          const stack = materialRows.find(x => x.itemId === itemId && Number(x.quantity) > 0);
          if (!stack) throw new BadRequestException('Missing required material: ' + (this.dataService.getItemById(itemId)?.name ?? itemId));
          stack.quantity = Number(stack.quantity) - 1;
          if (stack.quantity <= 0) await invRepo.remove(stack); else await invRepo.save(stack);
        };
        await consumeOne('mat_bliss_stone');
        if (useDivineShard) await consumeOne('mat_divine_shard');
        const attempt = Math.max(0, Math.floor(Number(instanceData.refinementAttempts ?? 0))) + 1;
        const roll = createHash('sha256').update(`${characterId}:${row.id}:refine:${attempt}:${level}`).digest().readUInt32BE(0) % 100;
        const chance = this.refinementChances[level];
        if (roll < chance) {
          const nextLevel = level + 1;
          instanceData.refinementAttempts = attempt;
          instanceData.refinementLevel = nextLevel;
          if (instanceData.rolledAttribute && instanceData.craftedByProfession && instanceData.rolledValue !== undefined) {
            if (instanceData.refinementBaseRolledValue === undefined) instanceData.refinementBaseRolledValue = Number(instanceData.rolledValue);
            instanceData.rolledValue = Number(instanceData.refinementBaseRolledValue) + Math.max(0, nextLevel - 6) * 2;
          }
          if (instanceData.rolledStat && instanceData.rolledStatValue !== undefined) {
            if (instanceData.refinementBaseRolledStatValue === undefined) instanceData.refinementBaseRolledStatValue = Number(instanceData.rolledStatValue);
            instanceData.rolledStatValue = Number(instanceData.refinementBaseRolledStatValue) + Math.max(0, nextLevel - 6) * (this.refinementStatGain[String(instanceData.rolledStat)] ?? 0);
          }
          row.instanceData = instanceData; await invRepo.save(row);
          return { outcome: 'success', chancePercent: chance, roll, previousLevel: level, refinementLevel: nextLevel, itemId: row.itemId, destroyed: false, useDivineShard };
        }
        instanceData.refinementAttempts = attempt;
        const failureOutcome = resolveRefinementFailure(level, useDivineShard);
        if (failureOutcome.destroyed) {
          await invRepo.remove(row);
          return { outcome: 'destroyed', chancePercent: chance, roll, previousLevel: level, refinementLevel: null, itemId: row.itemId, destroyed: true, useDivineShard };
        }
        const nextLevel = failureOutcome.nextLevel;
        instanceData.refinementLevel = nextLevel;
        if (instanceData.rolledAttribute && instanceData.refinementBaseRolledValue !== undefined) instanceData.rolledValue = Number(instanceData.refinementBaseRolledValue) + Math.max(0, nextLevel - 6) * 2;
        if (instanceData.rolledStat && instanceData.refinementBaseRolledStatValue !== undefined) instanceData.rolledStatValue = Number(instanceData.refinementBaseRolledStatValue) + Math.max(0, nextLevel - 6) * (this.refinementStatGain[String(instanceData.rolledStat)] ?? 0);
        row.instanceData = instanceData; await invRepo.save(row);
        return { outcome: 'failure', chancePercent: chance, roll, previousLevel: level, refinementLevel: nextLevel, itemId: row.itemId, destroyed: false, useDivineShard };
      })
    );
  }

  /**
   * Equip an item in a slot
   * Validates compatibility and triggers battle queue invalidation
   */
  async equipItem(characterId: string, slot: string, itemId: string): Promise<EquippedItem> {
    return this.battleService.runFutureCombatMutation(characterId, () => this.equipItemMutation(characterId, slot, itemId));
  }

  private async equipItemMutation(characterId: string, slot: string, itemId: string): Promise<EquippedItem> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    const itemDef = this.dataService.getItemById(itemId);
    if (!itemDef || itemDef.type !== 'equipment') throw new BadRequestException('Item is not equipment');
    const slotCompatible = itemDef.slot === slot || (slot === 'offHand' && itemDef.secondaryHand === true) || (itemDef.slot === 'accessory' && (slot === 'accessoryLeft' || slot === 'accessoryRight'));
    if (!slotCompatible) throw new BadRequestException(`Item ${itemId} cannot be equipped in slot ${slot}`);
    if (character.level < (itemDef.levelReq || 1)) {
      throw new BadRequestException(`Character level ${character.level} is below requirement ${itemDef.levelReq}`);
    }

    const current = await this.getEquippedInSlot(characterId, slot);
    if (current?.itemId === itemId && !character.pendingEquipmentChanges?.[slot]) return current;

    if (slot === 'mainHand' || slot === 'offHand') {
      const validation = await this.validateWeaponCombination(
        characterId,
        slot === 'mainHand' ? itemId : undefined,
        slot === 'offHand' ? itemId : undefined,
      );
      if (!validation.valid) throw new BadRequestException(`Weapon combination invalid: ${validation.errors?.join(', ')}`);
    }

    const source = await this.inventoryItemRepo.findOne({
      where: { characterId, location: 'inventory', itemId },
      order: { slotIndex: 'ASC' },
    });
    if (!source) throw new BadRequestException('Equipment item must be in inventory');

    const first = await this.battleQueueRepo.findOne({
      where: { characterId, resolved: false },
      order: { sequenceIndex: 'ASC' },
    });
    const now = Date.now();
    const activeBattle = first && first.startAt.getTime() <= now && now < first.endAt.getTime();
    const grindHasScheduledBattle = character.status === 'grinding' && !!activeBattle;

    if (grindHasScheduledBattle) {
      const pending = { ...(character.pendingEquipmentChanges ?? {}) };
      const previous = pending[slot];
      if (previous) await this.addEquipmentToInventory(characterId, previous.itemId, previous.instanceData);

      const pendingMain = pending.mainHand?.itemId
        ? this.dataService.getItemById(pending.mainHand.itemId)
        : pending.mainHand === null
          ? null
          : await this.getEquippedInSlot(characterId, 'mainHand').then((equipped) => equipped ? this.dataService.getItemById(equipped.itemId) : null);
      const conflictingSlot = this.getConflictingHandSlot(slot, itemDef, pendingMain);
      if (conflictingSlot) {
        const conflictingPending = pending[conflictingSlot];
        if (conflictingPending) {
          await this.addEquipmentToInventory(characterId, conflictingPending.itemId, conflictingPending.instanceData);
        }
        pending[conflictingSlot] = null;
      }

      await this.inventoryItemRepo.delete(source.id);
      pending[slot] = { itemId, instanceData: source.instanceData ?? null };
      character.pendingEquipmentChanges = pending;
      await this.characterRepo.save(character);
      this.logger.debug(`Character ${characterId} staged ${itemId} for ${slot}`);
      return current ?? this.equippedItemRepo.create({ characterId, slot, itemId: itemId, instanceData: source.instanceData ?? null });
    }

    const currentMain = await this.getEquippedInSlot(characterId, 'mainHand');
    const conflictingSlot = this.getConflictingHandSlot(
      slot,
      itemDef,
      currentMain ? this.dataService.getItemById(currentMain.itemId) : null,
    );
    if (conflictingSlot) {
      const conflicting = await this.getEquippedInSlot(characterId, conflictingSlot);
      if (conflicting) {
        await this.addEquipmentToInventory(characterId, conflicting.itemId, conflicting.instanceData);
        await this.equippedItemRepo.delete(conflicting.id);
      }
    }

    if (current && current.itemId !== itemId) await this.addEquipmentToInventory(characterId, current.itemId, current.instanceData);
    await this.inventoryItemRepo.delete(source.id);
    if (current) {
      current.itemId = itemId;
      current.instanceData = source.instanceData ?? null;
      await this.equippedItemRepo.save(current);
    } else {
      await this.equippedItemRepo.save(this.equippedItemRepo.create({
        characterId, slot, itemId, instanceData: source.instanceData ?? null,
      }));
    }
    character.lastSeenAt = new Date();
    await this.characterRepo.save(character);
    return this.getEquippedInSlot(characterId, slot).then((equipped) => equipped as EquippedItem);
  }

  /**
   * Unequip an item from a slot
   */
  async unequipItem(characterId: string, slot: string): Promise<void> {
    return this.battleService.runFutureCombatMutation(characterId, () => this.unequipItemMutation(characterId, slot));
  }

  private async unequipItemMutation(characterId: string, slot: string): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    const equipped = await this.getEquippedInSlot(characterId, slot);
    if (equipped) {
      if (slot === 'mainHand' && await this.getEquippedInSlot(characterId, 'offHand')) {
        throw new BadRequestException('Remove the secondary item before removing the primary weapon');
      }
      const active = await this.battleQueueRepo.findOne({ where: { characterId, resolved: false }, order: { sequenceIndex: 'ASC' } });
      const now = Date.now();
      if (character.status === 'grinding' && active && active.startAt.getTime() <= now && now < active.endAt.getTime()) {
        character.pendingEquipmentChanges = { ...(character.pendingEquipmentChanges ?? {}), [slot]: null };
        await this.characterRepo.save(character);
        return;
      }
      await this.addEquipmentToInventory(characterId, equipped.itemId, equipped.instanceData);
      await this.equippedItemRepo.delete(equipped.id);
      character.lastSeenAt = new Date();
      await this.characterRepo.save(character);
      this.logger.debug(`Character ${characterId} unequipped from slot ${slot}`);
    }
  }

  private getConflictingHandSlot(
    slot: string,
    itemDefinition: any,
    currentMainDefinition?: any,
  ): 'mainHand' | 'offHand' | null {
    const twoHanded = itemDefinition?.twoHanded === true;
    if (slot === 'offHand' && currentMainDefinition?.twoHanded) return null;
    if (slot === 'mainHand' && twoHanded) return 'offHand';
    return null;
  }

  private async addEquipmentToInventory(characterId: string, itemId: string, instanceData: any, manager?: EntityManager): Promise<void> {
    const inventoryRepo = manager?.getRepository(InventoryItem) ?? this.inventoryItemRepo;
    const rows = await inventoryRepo.find({
      where: { characterId, location: 'inventory' },
      order: { slotIndex: 'ASC' },
    });
    const used = new Set(rows.map((row) => row.slotIndex));
    for (let slotIndex = 0; slotIndex < 50; slotIndex += 1) {
      if (used.has(slotIndex)) continue;
      await inventoryRepo.save(inventoryRepo.create({
        characterId,
        location: 'inventory',
        slotIndex,
        itemId,
        quantity: 1,
        instanceData: instanceData ?? null,
      }));
      return;
    }
    throw new BadRequestException('Inventory is full');
  }

  async applyPendingEquipmentChanges(characterId: string, manager?: EntityManager): Promise<boolean> {
    const characterRepo = manager?.getRepository(Character) ?? this.characterRepo;
    const equippedRepo = manager?.getRepository(EquippedItem) ?? this.equippedItemRepo;
    const character = await characterRepo.findOne({ where: { id: characterId } });
    if (!character?.pendingEquipmentChanges) return false;

    const pending = character.pendingEquipmentChanges;
    for (const [slot, change] of Object.entries(pending)) {
      const current = await this.getEquippedInSlot(characterId, slot, manager);

      if (change === null) {
        if (current) {
          await this.addEquipmentToInventory(characterId, current.itemId, current.instanceData, manager);
          await equippedRepo.delete(current.id);
        }
        continue;
      }

      if (!change) continue;
      if (current && current.itemId !== change.itemId) {
        await this.addEquipmentToInventory(characterId, current.itemId, current.instanceData, manager);
      }
      if (current) {
        current.itemId = change.itemId;
        current.instanceData = change.instanceData ?? null;
        await equippedRepo.save(current);
      } else {
        await equippedRepo.save(equippedRepo.create({
          characterId, slot, itemId: change.itemId, instanceData: change.instanceData ?? null,
        }));
      }
    }

    character.pendingEquipmentChanges = null as any;
    await characterRepo.save(character);
    this.logger.log(`Applied pending equipment changes for ${characterId}`);
    return true;
  }

  /**
   * Validate weapon combination (dual wield rules per SPEC §5.3)
   * Valid combinations: Sword+Shield, Sword+Sword, Sword+Dagger, Dagger+Shield,
   * Dagger+Dagger, or 2H weapons (Greatsword, Bow, Staff, Rod) alone
   */
  async validateWeaponCombination(
    characterId: string,
    mainWeapon?: string,
    offHandWeapon?: string,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    const current = await this.getEquipment(characterId);
    const mainEquipped = current.find((e) => e.slot === 'mainHand');
    const offEquipped = current.find((e) => e.slot === 'offHand');

    // Determine what will be equipped after this change
    const requestedMain = mainWeapon !== undefined ? this.dataService.getItemById(mainWeapon) : null;
    const requestedOff = offHandWeapon !== undefined ? this.dataService.getItemById(offHandWeapon) : null;

    const currentMainType = mainEquipped
      ? this.dataService.getItemById(mainEquipped.itemId)?.weaponType as string
      : undefined;
    // A secondary request never silently removes an incompatible primary.
    const newMain =
      mainWeapon !== undefined
        ? requestedMain
        : mainEquipped ? this.dataService.getItemById(mainEquipped.itemId) : null;

    // Equipping a 2H weapon clears offHand.
    const newOff =
      offHandWeapon !== undefined
        ? requestedOff
        : mainWeapon !== undefined && !!requestedMain?.twoHanded
          ? null
          : offEquipped
            ? this.dataService.getItemById(offEquipped.itemId)
            : null;

    errors.push(...validateHandLoadout(newMain, newOff));

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Get character's current loadout summary
   */
  async getLoadoutSummary(characterId: string): Promise<any> {
    const equipped = await this.getEquipment(characterId);
    const stats = await this.calculateEquipmentStats(characterId);

    return {
      equipped: equipped.map((e) => ({
        slot: e.slot,
        itemId: e.itemId,
        itemName: this.dataService.getItemById(e.itemId)?.name,
        instanceData: e.instanceData,
      })),
      totalStats: stats,
    };
  }
}
