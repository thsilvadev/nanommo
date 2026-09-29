import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EquippedItem } from '../../database/entities/equipped-item.entity';
import { Character } from '../../database/entities/character.entity';
import { WeaponProficiency } from '../../database/entities/weapon-proficiency.entity';
import { DataService } from '../data/data.service';
import { BattleEngine } from '@nanommo/shared';

export interface EquipmentStats {
  def: number;
  mdefPercent: number;
  statBonus: {
    STR?: number;
    AGI?: number;
    DEX?: number;
    VIT?: number;
    INT?: number;
    SOR?: number;
  };
  weaponFixedAtk?: number;
  weaponFixedMatk?: number;
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
  hpRegenPerTick: number;
  spRegenPerTick: number;
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
      if (itemDef.fixedStats?.def) {
        stats.def += itemDef.fixedStats.def;
      }
      if (itemDef.fixedStats?.mdefPercent) {
        stats.mdefPercent += itemDef.fixedStats.mdefPercent;
      }

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

      // Add weapon fixed attack values
      if (equip.slot === 'mainHand' && itemDef.fixedStats?.atk) {
        stats.weaponFixedAtk = (stats.weaponFixedAtk || 0) + itemDef.fixedStats.atk;
      }

      // TODO: Add magic attack from weapons if applicable
      // if (itemDef.fixedStats?.matk) {
      //   stats.weaponFixedMatk = (stats.weaponFixedMatk || 0) + itemDef.fixedStats.matk;
      // }
    }

    // Clamp MDEF% to 0-100 range
    stats.mdefPercent = Math.min(100, Math.max(0, stats.mdefPercent));

    return stats;
  }

  /**
   * Calculate derived stats for a character with current equipment
   */
  async calculateDerivedStats(character: Character): Promise<DerivedStats> {
    const equipStats=await this.calculateEquipmentStats(character.id);
    const equipped=await this.getEquipment(character.id);
    let maxHp=0,maxSp=0;
    for(const equip of equipped){const item=this.dataService.getItemById(equip.itemId);maxHp+=Number(item?.fixedStats?.maxHp??0);maxSp+=Number(item?.fixedStats?.maxSp??0);}
    const attrs={str:character.str+(equipStats.statBonus.STR||0),agi:character.agi+(equipStats.statBonus.AGI||0),dex:character.dex+(equipStats.statBonus.DEX||0),vit:character.vit+(equipStats.statBonus.VIT||0),int:character.int+(equipStats.statBonus.INT||0),sor:character.sor+(equipStats.statBonus.SOR||0)};
    const stats=BattleEngine.calculateDerivedStats(character.level,attrs,{def:equipStats.def,maxHp,maxSp,weaponFixedAtk:equipStats.weaponFixedAtk});
    return {...stats,matk:0,mdefPercent:equipStats.mdefPercent};
  }

  /**
   * Equip an item in a slot
   * Validates compatibility and triggers battle queue invalidation
   */
  async equipItem(
    characterId: string,
    slot: string,
    itemId: string,
  ): Promise<EquippedItem> {
    const character = await this.characterRepo.findOne({
      where: { id: characterId },
    });
    if (!character) throw new NotFoundException('Character not found');

    if (character.status === 'grinding' && slot === 'mainHand') {
      const current = await this.getEquippedInSlot(characterId, 'mainHand');
      if (current && current.itemId === itemId) return current;
    }

    const itemDef = this.dataService.getItemById(itemId);
    if (!itemDef || itemDef.type !== 'equipment') {
      throw new BadRequestException('Item is not equipment');
    }

    if (itemDef.slot !== slot) {
      throw new BadRequestException(
        `Item ${itemId} cannot be equipped in slot ${slot}`,
      );
    }

    if (character.level < (itemDef.levelReq || 1)) {
      throw new BadRequestException(
        `Character level ${character.level} is below requirement ${itemDef.levelReq}`,
      );
    }

    // Validate weapon combinations if equipping a weapon
    if (slot === 'mainHand' || slot === 'offHand') {
      const validation = await this.validateWeaponCombination(
        characterId,
        slot === 'mainHand' ? itemId : undefined,
        slot === 'offHand' ? itemId : undefined,
      );
      if (!validation.valid) {
        throw new BadRequestException(
          `Weapon combination invalid: ${validation.errors?.join(', ')}`,
        );
      }
    }

    // Upsert equipped item
    let equipped = await this.getEquippedInSlot(characterId, slot);
    if (equipped) {
      equipped.itemId = itemId;
      equipped.instanceData = null;
    } else {
      equipped = this.equippedItemRepo.create({
        characterId,
        slot,
        itemId,
      });
    }

    await this.equippedItemRepo.save(equipped);

    // TODO: Invalidate battle queue (call BattleService.invalidateQueue)
    this.logger.debug(
      `Character ${characterId} equipped ${itemId} in slot ${slot}`,
    );

    return equipped;
  }

  /**
   * Unequip an item from a slot
   */
  async unequipItem(characterId: string, slot: string): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    if (character.status === 'grinding' && slot === 'mainHand') {
      throw new BadRequestException('Cannot unequip the required main-hand weapon while grinding');
    }
    const equipped = await this.getEquippedInSlot(characterId, slot);
    if (equipped) {
      await this.equippedItemRepo.delete(equipped.id);

      // TODO: Invalidate battle queue
      this.logger.debug(`Character ${characterId} unequipped from slot ${slot}`);
    }
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
    const newMain =
      mainWeapon !== undefined
        ? this.dataService.getItemById(mainWeapon)
        : mainEquipped
          ? this.dataService.getItemById(mainEquipped.itemId)
          : null;
    const newOff =
      offHandWeapon !== undefined
        ? this.dataService.getItemById(offHandWeapon)
        : offEquipped
          ? this.dataService.getItemById(offEquipped.itemId)
          : null;

    if (!newMain && !mainWeapon) {
      // Unequipping main hand - always valid
      return { valid: true };
    }

    if (!newMain || newMain.type !== 'equipment') {
      return { valid: false, errors: ['Main hand must be a weapon'] };
    }

    const mainType = newMain?.weaponType as string;
    const isTwoHanded = ['greatsword', 'bow', 'staff', 'wand'].includes(
      mainType,
    );

    // Two-handed weapons cannot have off-hand
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
