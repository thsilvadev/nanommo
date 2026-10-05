import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
import { effectiveFoodStatValue } from '@nanommo/shared';

export function buildDietStateAfterFoodConsumption(
  currentDiet: Array<{ itemId: string; consumedAt: string; digestUntil: string; dietLevel: number }>,
  itemId: string,
  consumedAt: string,
  digestUntil: string,
): {
  diet: Array<{ itemId: string; consumedAt: string; digestUntil: string; dietLevel: number }>;
  dietLevels: Record<string, { level: number; lastDigestUntil: string }>;
  nextLevel: number;
} {
  const diet = Array.isArray(currentDiet) ? currentDiet.slice() : [];
  const previousEntry = [...diet].reverse().find((entry) => entry.itemId === itemId);
  const nextLevel = previousEntry
    ? Math.min(3, Math.max(0, Number(previousEntry.dietLevel ?? 0)) + 1)
    : 0;
  const nextDiet = [...diet.slice(-2), { itemId, consumedAt, digestUntil, dietLevel: nextLevel }];
  return {
    diet: nextDiet,
    dietLevels: Object.fromEntries(
      nextDiet.map((entry) => [
        entry.itemId,
        { level: Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0))), lastDigestUntil: entry.digestUntil },
      ]),
    ),
    nextLevel,
  };
}

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

  async consumeFood(characterId: string, itemId: string, manager?: EntityManager, consumeInventory = true): Promise<Character> {
    const item = this.dataService.getItemById(itemId);
    if (!item || item.type !== 'consumable' || item.effect?.type !== 'food_buff') {
      throw new BadRequestException('Item is not a food');
    }

    const apply = async (tx: EntityManager): Promise<Character> => {
      const characterRepo = tx.getRepository(Character);
      const inventoryRepo = tx.getRepository(InventoryItem);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');

      let stack: InventoryItem | undefined;
      if (consumeInventory) {
        const stacks = await inventoryRepo.find({
          where: { characterId, itemId, location: 'inventory' },
          order: { slotIndex: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        });
        stack = stacks.find((row) => row.quantity > 0);
        if (!stack) throw new BadRequestException('Insufficient item quantity');
      }

      const now = Date.now();
      const diet = Array.isArray(character.diet) ? character.diet.slice() : [];
      const previousEntry = [...diet].reverse().find((entry) => entry.itemId === itemId);
      const previousDigestUntil = previousEntry?.digestUntil ? Date.parse(previousEntry.digestUntil) : 0;
      if (previousDigestUntil > now) throw new BadRequestException('Food is still digesting');

      const consumedAt = new Date(now).toISOString();
      const digestUntil = new Date(now + Number(item.effect?.durationSeconds ?? 0) * 1000).toISOString();
      const dietState = buildDietStateAfterFoodConsumption(diet, itemId, consumedAt, digestUntil);

      if (stack) {
        stack.quantity -= 1;
        if (stack.quantity <= 0) await inventoryRepo.remove(stack);
        else await inventoryRepo.save(stack);
      }

      character.diet = dietState.diet;
      character.dietLevels = dietState.dietLevels;
      character.activeFoodBuff = {
        itemId,
        hpRegenPerTenTicks: effectiveFoodStatValue(item.effect?.hpRegenPerTenTicks, dietState.nextLevel),
        spRegenPerTenTicks: effectiveFoodStatValue(item.effect?.spRegenPerTenTicks, dietState.nextLevel),
        expiresAt: digestUntil,
      };
      character.lastSeenAt = new Date();
      return characterRepo.save(character);
    };

    if (manager) return apply(manager);

    const queryRunner = this.characterRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const saved = await apply(queryRunner.manager);
      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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
      const updated = await this.consumeFood(characterId, itemId);
      return { character: updated, itemId };
    }
    character.lastSeenAt = new Date();
    if (effect.type === 'heal_hp') {
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

  /** TEMP DEV CHEAT — remove after Diet/food QA is complete. */
  async grantAllFoodsCheat(quantity = 10) {
    const [candidate] = await this.characterRepo.find({
      order: { updatedAt: 'DESC' },
      take: 1,
    });
    if (!candidate) throw new NotFoundException('Character not found');

    const character = await this.characterRepo.findOne({ where: { id: candidate.id } });
    if (!character) throw new NotFoundException('Character not found');
    const itemCatalog = this.dataService.getItems();
    const consumables = Array.isArray(itemCatalog) ? itemCatalog : itemCatalog?.consumables ?? [];
    const foods = consumables.filter((item: any) => item?.type === 'consumable' && item?.effect?.type === 'food_buff');
    const granted = [];
    for (const food of foods) {
      const result = await this.addItem(character.id, food.id, quantity, 'inventory');
      granted.push({ itemId: food.id, quantity, slotIndex: result.slotIndex });
    }
    return { characterId: character.id, quantity, foods: granted };
  }

  /**
   * Strip baked food `use_item` events out of a character's unresolved battles.
   *
   * The events live inside `battle_queue_entries.log`, frozen when the battle was
   * queued. `BattleService.applyResolvedFoodState` replays them on every resolve,
   * so a diet cheat would be undone by the next resolve. Reached through
   * `manager.getRepository(<table>)` to avoid depending on BattleService, which
   * already imports this module.
   *
   * TEMP DEV CHEAT — remove after Diet/food QA is complete.
   */
  private async stripQueuedFoodEvents(manager: EntityManager, characterId: string): Promise<number> {
    const queueRepo = manager.getRepository('battle_queue_entries');
    const pending = await queueRepo.find({ where: { characterId, resolved: false } });
    let stripped = 0;
    for (const entry of pending) {
      const events = Array.isArray(entry.log?.events) ? entry.log.events : [];
      const kept = events.filter((event: any) => {
        if (event?.action !== 'use_item') return true;
        return this.dataService.getItemById(event.itemId)?.effect?.type !== 'food_buff';
      });
      if (kept.length === events.length) continue;
      stripped += events.length - kept.length;
      entry.log = { ...(entry.log ?? {}), events: kept };
      await queueRepo.save(entry);
    }
    return stripped;
  }

  /** TEMP DEV CHEAT — remove after Diet/food QA is complete. */
  async resetDietCheat() {
    const character = await this.characterRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Character);
      const [candidate] = await repo.find({
        order: { updatedAt: 'DESC' },
        take: 1,
      });
      if (!candidate) throw new NotFoundException('Character not found');

      const character = await repo.findOne({
        where: { id: candidate.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('Character not found');

      this.logger.warn(
        `RESET DIET cheat target: characterId=${character.id} name=${character.name} status=${character.status} currentMapId=${character.currentMapId ?? 'null'} dietCount=${Array.isArray(character.diet) ? character.diet.length : 0} activeFoodBuff=${character.activeFoodBuff ? 'present' : 'null'}`,
      );

      const now = new Date().toISOString();
      const diet = Array.isArray(character.diet)
        ? character.diet.map((entry) => ({ ...entry, digestUntil: now }))
        : [];

      // This QA cheat is intentionally non-destructive: it only finishes digestion.
      // Retained slots and their diet levels are the state being tested by
      // /upgrade-diet and subsequent food consumption.
      character.diet = diet;
      character.activeFoodBuff = null;
      character.lastSeenAt = new Date();
      const strippedFoodEvents = await this.stripQueuedFoodEvents(manager, character.id);
      const saved = await repo.save(character);
      return { saved, strippedFoodEvents };
    });

    return {
      characterId: character.saved.id,
      hungry: true,
      autoFeed: character.saved.autoFeed,
      diet: character.saved.diet,
      dietLevels: character.saved.dietLevels,
      activeFoodBuff: character.saved.activeFoodBuff,
      strippedFoodEvents: character.strippedFoodEvents,
    };
  }

  /** TEMP DEV CHEAT — remove after Diet/food QA is complete. */
  async upgradeDietCheat() {
    const character = await this.characterRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Character);
      const [candidate] = await repo.find({
        order: { updatedAt: 'DESC' },
        take: 1,
      });
      if (!candidate) throw new NotFoundException('Character not found');

      const character = await repo.findOne({
        where: { id: candidate.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('Character not found');

      const diet = Array.isArray(character.diet) ? character.diet.map((entry) => ({ ...entry })) : [];
      this.logger.warn(
        `UPGRADE DIET cheat target: characterId=${character.id} name=${character.name} status=${character.status} dietCount=${diet.length}`,
      );

      const dietLevels = { ...(character.dietLevels ?? {}) };
      for (const entry of diet) {
        const currentLevel = Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0)));
        const nextLevel = Math.min(3, currentLevel + 1);
        entry.dietLevel = nextLevel;

        const mastery = dietLevels[entry.itemId];
        const masteryLevel = Math.max(0, Math.min(3, Number(mastery?.level ?? 0)));
        dietLevels[entry.itemId] = {
          level: Math.min(3, Math.max(masteryLevel, nextLevel)),
          lastDigestUntil: mastery?.lastDigestUntil ?? entry.digestUntil,
        };
      }

      character.diet = diet;
      character.dietLevels = dietLevels;
      character.lastSeenAt = new Date();
      const strippedFoodEvents = await this.stripQueuedFoodEvents(manager, character.id);
      const saved = await repo.save(character);
      return { saved, strippedFoodEvents };
    });

    return {
      characterId: character.saved.id,
      diet: character.saved.diet,
      dietLevels: character.saved.dietLevels,
      activeFoodBuff: character.saved.activeFoodBuff,
      strippedFoodEvents: character.strippedFoodEvents,
    };
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
