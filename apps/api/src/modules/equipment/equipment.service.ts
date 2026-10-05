import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EquippedItem } from '../../database/entities/equipped-item.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { WeaponProficiency } from '../../database/entities/weapon-proficiency.entity';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { DataService } from '../data/data.service';
import { BattleEngine } from '@nanommo/shared';

export interface EquipmentStats {
  def: number;
  mdefPercent: number;
  maxHp: number;
  maxSp: number;
  weaponFixedAtk: number;
  weaponFixedMatk: number;
  statBonus: {
    STR?: number;
    AGI?: number;
    DEX?: number;
    VIT?: number;
    INT?: number;
    SOR?: number;
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
  ) {}

  /**
   * All equipped items for a character
   */
  async getEquipment(characterId: string): Promise<EquippedItem[]> {
    return this.equippedItemRepo.find({
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
      levels[row.weaponType] = Number(row.level ?? 1);
    }
    return levels;
  }


  /**
   * Get item equipped in a specific slot
   */
  async getEquippedInSlot(
    characterId: string,
    slot: string,
  ): Promise<EquippedItem | null> {
    return this.equippedItemRepo.findOne({
      where: { characterId, slot },
    });
  }

  /**
   * Calculate total equipment stats (DEF, MDEF%, attribute bonuses)
   * Used in character stats calculation
   */
  async calculateEquipmentStats(characterId: string): Promise<EquipmentStats> {
    const equipped = await this.getEquipment(characterId);
    const stats: EquipmentStats = {
      def: 0,
      mdefPercent: 0,
      maxHp: 0,
      maxSp: 0,
      weaponFixedAtk: 0,
      weaponFixedMatk: 0,
      statBonus: {
        STR: 0,
        AGI: 0,
        DEX: 0,
        VIT: 0,
        INT: 0,
        SOR: 0,
      },
    };

    for (const equip of equipped) {
      const itemDef = this.dataService.getItemById(equip.itemId);
      if (!itemDef || itemDef.type !== 'equipment') continue;

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
        const attr = equip.instanceData.rolledAttribute as keyof typeof stats.statBonus;
        if (stats.statBonus[attr] !== undefined) {
          stats.statBonus[attr] += equip.instanceData.rolledValue;
        }
      }

      // Weapon fixed contributions only come from the main-hand weapon.
      if (equip.slot === 'mainHand') {
        stats.weaponFixedAtk += Number(itemDef.fixedStats?.atk ?? 0);
        stats.weaponFixedMatk += Number(itemDef.fixedStats?.matk ?? 0);
      }
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
    const attrs = {
      str: character.str + (equipStats.statBonus.STR || 0),
      agi: character.agi + (equipStats.statBonus.AGI || 0),
      dex: character.dex + (equipStats.statBonus.DEX || 0),
      vit: character.vit + (equipStats.statBonus.VIT || 0),
      int: character.int + (equipStats.statBonus.INT || 0),
      sor: character.sor + (equipStats.statBonus.SOR || 0),
    };
    return BattleEngine.calculateDerivedStats(character.level, attrs, equipStats);
  }

  /**
   * Equip an item in a slot
   * Validates compatibility and triggers battle queue invalidation
   */
  async equipItem(characterId: string, slot: string, itemId: string): Promise<EquippedItem> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    const itemDef = this.dataService.getItemById(itemId);
    if (!itemDef || itemDef.type !== 'equipment') throw new BadRequestException('Item is not equipment');
    const slotCompatible = itemDef.slot === slot || (itemDef.slot === 'accessory' && (slot === 'accessoryLeft' || slot === 'accessoryRight'));
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
    const grindHasScheduledBattle = character.status === 'grinding' && !!first;

    if (grindHasScheduledBattle) {
      const pending = { ...(character.pendingEquipmentChanges ?? {}) };
      const previous = pending[slot];
      if (previous) await this.addEquipmentToInventory(characterId, previous.itemId, previous.instanceData);

      const pendingMain = pending.mainHand?.itemId
        ? this.dataService.getItemById(pending.mainHand.itemId)
        : pending.mainHand === null
          ? null
          : await this.getEquippedInSlot(characterId, 'mainHand').then((equipped) => equipped ? this.dataService.getItemById(equipped.itemId) : null);
      const conflictingSlot = this.getConflictingHandSlot(slot, itemDef.weaponType as string, pendingMain?.weaponType as string | undefined);
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
      itemDef.weaponType as string,
      currentMain ? this.dataService.getItemById(currentMain.itemId)?.weaponType as string : undefined,
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
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    if (character.status === 'grinding') {
      throw new BadRequestException('Equipment can only be unequipped in town');
    }
    const equipped = await this.getEquippedInSlot(characterId, slot);
    if (equipped) {
      await this.addEquipmentToInventory(characterId, equipped.itemId, equipped.instanceData);
      await this.equippedItemRepo.delete(equipped.id);
      character.lastSeenAt = new Date();
      await this.characterRepo.save(character);
      this.logger.debug(`Character ${characterId} unequipped from slot ${slot}`);
    }
  }

  private getConflictingHandSlot(
    slot: string,
    weaponType: string,
    currentMainWeaponType?: string,
  ): 'mainHand' | 'offHand' | null {
    const twoHanded = ['greatsword', 'bow', 'staff', 'wand'].includes(weaponType);
    if (slot === 'offHand' && ['greatsword', 'bow', 'staff', 'wand'].includes(currentMainWeaponType ?? '')) return 'mainHand';
    if (slot === 'mainHand' && twoHanded) return 'offHand';
    return null;
  }

  private async addEquipmentToInventory(characterId: string, itemId: string, instanceData: any): Promise<void> {
    const rows = await this.inventoryItemRepo.find({
      where: { characterId, location: 'inventory' },
      order: { slotIndex: 'ASC' },
    });
    const used = new Set(rows.map((row) => row.slotIndex));
    for (let slotIndex = 0; slotIndex < 50; slotIndex += 1) {
      if (used.has(slotIndex)) continue;
      await this.inventoryItemRepo.save(this.inventoryItemRepo.create({
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

  async applyPendingEquipmentChanges(characterId: string): Promise<boolean> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character?.pendingEquipmentChanges) return false;

    const pending = character.pendingEquipmentChanges;
    for (const [slot, change] of Object.entries(pending)) {
      const current = await this.getEquippedInSlot(characterId, slot);

      if (change === null) {
        if (current) {
          await this.addEquipmentToInventory(characterId, current.itemId, current.instanceData);
          await this.equippedItemRepo.delete(current.id);
        }
        continue;
      }

      if (!change) continue;
      if (current && current.itemId !== change.itemId) {
        await this.addEquipmentToInventory(characterId, current.itemId, current.instanceData);
      }
      if (current) {
        current.itemId = change.itemId;
        current.instanceData = change.instanceData ?? null;
        await this.equippedItemRepo.save(current);
      } else {
        await this.equippedItemRepo.save(this.equippedItemRepo.create({
          characterId, slot, itemId: change.itemId, instanceData: change.instanceData ?? null,
        }));
      }
    }

    character.pendingEquipmentChanges = null as any;
    await this.characterRepo.save(character);
    this.logger.log(`Applied pending equipment changes for ${characterId}`);
    return true;
  }

  /**
   * Validate weapon combination (dual wield rules per SPEC §5.3)
   * Valid combinations: Sword+Shield, Sword+Sword, Sword+Dagger, Dagger+Shield,
   * Dagger+Dagger, or 2H weapons (Greatsword, Bow, Staff, Wand) alone
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
    const requestedMainIsTwoHanded = ['greatsword', 'bow', 'staff', 'wand'].includes(
      String(requestedMain?.weaponType ?? ''),
    );

    const currentMainType = mainEquipped
      ? this.dataService.getItemById(mainEquipped.itemId)?.weaponType as string
      : undefined;
    const currentMainIsTwoHanded = ['greatsword', 'bow', 'staff', 'wand'].includes(currentMainType ?? '');

    // Equipping an off-hand while a 2H weapon is active clears mainHand.
    const newMain =
      mainWeapon !== undefined
        ? requestedMain
        : offHandWeapon !== undefined && currentMainIsTwoHanded
          ? null
          : mainEquipped
            ? this.dataService.getItemById(mainEquipped.itemId)
            : null;

    // Equipping a 2H weapon clears offHand.
    const newOff =
      offHandWeapon !== undefined
        ? requestedOff
        : mainWeapon !== undefined && requestedMainIsTwoHanded
          ? null
          : offEquipped
            ? this.dataService.getItemById(offEquipped.itemId)
            : null;

    if (!newMain) {
      if (!newOff) return { valid: true };
      if (newOff.type !== 'equipment' || newOff.weaponType !== 'shield') {
        return { valid: false, errors: ['An off-hand without a main-hand weapon must be a shield'] };
      }
      return { valid: true };
    }

    if (newMain.type !== 'equipment') {
      return { valid: false, errors: ['Main hand must be a weapon'] };
    }

    const mainType = newMain.weaponType as string;
    const isTwoHanded = ['greatsword', 'bow', 'staff', 'wand'].includes(mainType);

    // Two-handed weapons occupy both hand slots; equipping one clears offHand.
    if (isTwoHanded && newOff) {
      errors.push(
        `${mainType} is two-handed and cannot have an off-hand weapon`,
      );
    }

    // One-handed weapon validation
    if (!isTwoHanded && newOff) {
      const offType = newOff.weaponType as string;

      // Valid combinations: Sword+Shield, Sword+Sword, Sword+Dagger,
      // Dagger+Shield, Dagger+Dagger
      const validPairs: Record<string, string[]> = {
        sword: ['shield', 'sword', 'dagger'],
        dagger: ['shield', 'dagger'],
        bow: [], // Bow is always 2H
        staff: [], // Staff is always 2H
        wand: [], // Wand is always 2H
      };

      if (!validPairs[mainType] || !validPairs[mainType].includes(offType)) {
        errors.push(
          `Invalid weapon combination: ${mainType} + ${offType}`,
        );
      }
    }

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
