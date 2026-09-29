import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(InventoryItem)
    private readonly inventoryItemRepo: Repository<InventoryItem>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    private readonly dataService: DataService,
  ) {}

  /**
   * Get all inventory items for a character
   */
  async getInventory(characterId: string): Promise<InventoryItem[]> {
    return this.inventoryItemRepo.find({
      where: { characterId, location: 'inventory' },
      order: { slotIndex: 'ASC' },
    });
  }

  /**
   * Get all warehouse items for a character
   */
  async getWarehouse(characterId: string): Promise<InventoryItem[]> {
    return this.inventoryItemRepo.find({
      where: { characterId, location: 'warehouse' },
      order: { slotIndex: 'ASC' },
    });
  }

  /**
   * Get inventory item count for a specific item
   */
  async getItemCount(characterId: string, itemId: string): Promise<number> {
    const item = await this.inventoryItemRepo.findOne({
      where: { characterId, itemId },
    });
    return item?.quantity ?? 0;
  }

  /**
   * Check if location has free slots
   */
  private async getFreeSlots(
    characterId: string,
    location: 'inventory' | 'warehouse',
  ): Promise<number> {
    const maxSlots = location === 'inventory' ? 50 : 10;
    const usedSlots = await this.inventoryItemRepo.count({
      where: { characterId, location },
    });
    return maxSlots - usedSlots;
  }

  /**
   * Get next available slot index
   */
  private async getNextSlot(
    characterId: string,
    location: 'inventory' | 'warehouse',
  ): Promise<number> {
    const maxSlots = location === 'inventory' ? 50 : 10;
    const items = await this.inventoryItemRepo.find({
      where: { characterId, location },
      order: { slotIndex: 'ASC' },
    });

    const usedSlots = new Set(items.map((i) => i.slotIndex));
    for (let i = 0; i < maxSlots; i++) {
      if (!usedSlots.has(i)) {
        return i;
      }
    }

    throw new BadRequestException('No available slots');
  }

  /**
   * Add item(s) to inventory or warehouse with automatic stacking
   * Falls back to warehouse if inventory is full
   */
  async addItem(
    characterId: string,
    itemId: string,
    quantity: number,
    location: 'inventory' | 'warehouse' = 'inventory',
    instanceData?: any,
  ): Promise<InventoryItem> {
    const item = this.dataService.getItemById(itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);

    let remaining = quantity;
    let lastItem: InventoryItem;

    // Try to add to existing stack if stackable
    if (item.stackable && item.maxStack && item.maxStack > 1) {
      const existingStacks = await this.inventoryItemRepo.find({
        where: { characterId, location, itemId },
      });

      for (const stack of existingStacks) {
        const space = item.maxStack - stack.quantity;
        if (space > 0) {
          const toAdd = Math.min(remaining, space);
          stack.quantity += toAdd;
          lastItem = await this.inventoryItemRepo.save(stack);
          remaining -= toAdd;

          if (remaining === 0) {
            return lastItem;
          }
        }
      }
    }

    // Try to create new slot for remaining quantity
    if (remaining > 0) {
      const freeSlots = await this.getFreeSlots(characterId, location);

      if (freeSlots === 0) {
        // Inventory full, try warehouse fallback
        if (location === 'inventory') {
          this.logger.debug(
            `Inventory full for character ${characterId}, falling back to warehouse`,
          );
          return this.addItem(characterId, itemId, remaining, 'warehouse', instanceData);
        }
        throw new BadRequestException('Inventory and warehouse full');
      }

      // Split remaining into stacks if needed
      while (remaining > 0) {
        const slot = await this.getNextSlot(characterId, location);
        const stackSize = item.stackable
          ? Math.min(remaining, item.maxStack || remaining)
          : 1;

        const newItem = this.inventoryItemRepo.create({
          characterId,
          location,
          slotIndex: slot,
          itemId,
          quantity: stackSize,
          instanceData: instanceData || null,
        });

        lastItem = await this.inventoryItemRepo.save(newItem);
        remaining -= stackSize;

        if (remaining === 0) {
          return lastItem;
        }
      }
    }

    // All items added successfully
    if (remaining === 0) {
      // If lastItem was set during stacking or creation, return it
      if (lastItem) {
        return lastItem;
      }
      // Fallback: fetch the most recently added item
      const recentItem = await this.inventoryItemRepo.findOne({
        where: { characterId, itemId, location },
        order: { slotIndex: 'DESC' },
      });
      if (recentItem) {
        return recentItem;
      }
    }

    // Error: couldn't add all items
    throw new BadRequestException(
      `Failed to add item: remaining=${remaining}, lastItem=${lastItem ? 'exists' : 'undefined'}`,
    );
  }

  /**
   * Remove item(s) from inventory
   */
  async removeItem(
    characterId: string,
    itemId: string,
    quantity: number,
  ): Promise<void> {
    let remaining = quantity;

    // Find and remove from stacks
    const items = await this.inventoryItemRepo.find({
      where: { characterId, itemId },
    });

    for (const item of items) {
      if (remaining === 0) break;

      const toRemove = Math.min(remaining, item.quantity);
      item.quantity -= toRemove;
      remaining -= toRemove;

      if (item.quantity <= 0) {
        await this.inventoryItemRepo.remove(item);
      } else {
        await this.inventoryItemRepo.save(item);
      }
    }

    if (remaining > 0) {
      throw new BadRequestException('Insufficient item quantity');
    }
  }

  /**
   * Move item between inventory and warehouse
   */
  async transferItem(
    characterId: string,
    itemId: string,
    quantity: number,
    fromLocation: 'inventory' | 'warehouse',
    toLocation: 'inventory' | 'warehouse',
  ): Promise<InventoryItem> {
    if (fromLocation === toLocation) {
      throw new BadRequestException('Source and destination must be different');
    }

    // Get item from source location
    const sourceItem = await this.inventoryItemRepo.findOne({
      where: { characterId, itemId, location: fromLocation },
    });

    if (!sourceItem || sourceItem.quantity < quantity) {
      throw new BadRequestException('Insufficient quantity in source location');
    }

    // Remove from source
    sourceItem.quantity -= quantity;
    if (sourceItem.quantity === 0) {
      await this.inventoryItemRepo.remove(sourceItem);
    } else {
      await this.inventoryItemRepo.save(sourceItem);
    }

    // Add to destination
    return this.addItem(characterId, itemId, quantity, toLocation, sourceItem.instanceData);
  }

  /**
   * Transfer item to warehouse (convenience method)
   */
  async transferToWarehouse(
    characterId: string,
    itemId: string,
    quantity: number,
  ): Promise<InventoryItem> {
    return this.transferItem(characterId, itemId, quantity, 'inventory', 'warehouse');
  }

  /**
   * Transfer item from warehouse (convenience method)
   */
  async transferFromWarehouse(
    characterId: string,
    itemId: string,
    quantity: number,
  ): Promise<InventoryItem> {
    return this.transferItem(characterId, itemId, quantity, 'warehouse', 'inventory');
  }

  async useConsumable(characterId: string, itemId: string): Promise<{ character: Character; itemId: string }> {
    const item = this.dataService.getItemById(itemId);
    if (!item || item.type !== 'consumable') {
      throw new BadRequestException('Item is not a usable consumable');
    }
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    if (character.status === 'grinding') {
      throw new BadRequestException('Consumables can only be used manually outside battle');
    }

    const count = await this.getItemCount(characterId, itemId);
    if (count <= 0) throw new BadRequestException('Insufficient item quantity');

    const effect = item.effect ?? {};
    if (effect.type === 'food_buff') {
      character.activeFoodBuff = {
        itemId,
        hpRegenPerTenTicks: Number(effect.hpRegenPerTenTicks ?? 0),
        spRegenPerTenTicks: Number(effect.spRegenPerTenTicks ?? 0),
        expiresAt: new Date(Date.now() + Number(effect.durationSeconds ?? 0) * 1000).toISOString(),
      };
    } else if (effect.type === 'heal_hp') {
      const derived = await this.getDerivedStatsForCharacter(character);
      character.hpCurrent = Math.min(derived.maxHp, Number(character.hpCurrent) + Number(effect.amount ?? 0));
    } else if (effect.type === 'heal_sp') {
      const derived = await this.getDerivedStatsForCharacter(character);
      character.spCurrent = Math.min(derived.maxSp, Number(character.spCurrent) + Number(effect.amount ?? 0));
    } else if (effect.type === 'heal_hp_sp') {
      const derived = await this.getDerivedStatsForCharacter(character);
      character.hpCurrent = Math.min(derived.maxHp, Number(character.hpCurrent) + Number(effect.hpAmount ?? 0));
      character.spCurrent = Math.min(derived.maxSp, Number(character.spCurrent) + Number(effect.spAmount ?? 0));
    } else if (effect.type === 'cure_status' && effect.status) {
      character.statusEffects = (character.statusEffects ?? []).filter((s: any) => (s.type ?? s.id) !== effect.status);
    }

    await this.removeItem(characterId, itemId, 1);
    await this.characterRepo.save(character);
    return { character, itemId };
  }

  private async getDerivedStatsForCharacter(character: Character): Promise<{ maxHp: number; maxSp: number }> {
    const { BattleEngine } = await import('@nanommo/shared');
    const equipped = await this.dataService.getItems() && await this.characterRepo.manager.getRepository('equipped_items').find({ where: { characterId: character.id } });
    let maxHp = 0;
    let maxSp = 0;
    for (const row of equipped as any[]) {
      const item = this.dataService.getItemById(row.itemId);
      maxHp += Number(item?.fixedStats?.maxHp ?? 0);
      maxSp += Number(item?.fixedStats?.maxSp ?? 0);
    }
    const stats = BattleEngine.calculateDerivedStats(character.level, {
      str: character.str, agi: character.agi, dex: character.dex, vit: character.vit, int: character.int, sor: character.sor,
    }, { maxHp, maxSp });
    return { maxHp: stats.maxHp, maxSp: stats.maxSp };
  }

  /**
   * Sell item to vendor (removes from inventory, adds gold to character)
   */
  async sellToVendor(
    characterId: string,
    itemId: string,
    quantity: number,
  ): Promise<number> {
    const item = this.dataService.getItemById(itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);

    const goldPerUnit = item.sellPriceToVendor || 0;
    const totalGold = goldPerUnit * quantity;

    // Remove from inventory
    await this.removeItem(characterId, itemId, quantity);

    // Add gold to character
    const character = await this.characterRepo.findOne({
      where: { id: characterId },
    });
    if (!character) throw new NotFoundException('Character not found');

    character.gold = Math.min(
      Number(character.gold) + totalGold,
      1_000_000_000_000, // Gold cap
    );
    await this.characterRepo.save(character);

    this.logger.debug(
      `Sold ${quantity}x ${itemId} for ${totalGold} gold to character ${characterId}`,
    );

    return totalGold;
  }

  /**
   * Process battle drops into inventory
   */
  async processBattleDrops(
    characterId: string,
    drops: Array<{ itemId: string; quantity: number }>,
  ): Promise<InventoryItem[]> {
    const results: InventoryItem[] = [];

    for (const drop of drops) {
      try {
        const result = await this.addItem(characterId, drop.itemId, drop.quantity);
        results.push(result);
        this.logger.debug(
          `Added ${drop.quantity}x ${drop.itemId} to character ${characterId} inventory`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to add drop ${drop.itemId} to character ${characterId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Continue processing other drops even if one fails
      }
    }

    return results;
  }
}
