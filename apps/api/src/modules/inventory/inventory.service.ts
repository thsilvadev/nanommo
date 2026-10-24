import { Injectable, BadRequestException, NotFoundException, Logger, Optional } from '@nestjs/common';
import { IdleJournalService } from '../chat/chat-history.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { Character } from '../../database/entities/character.entity';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { DataService } from '../data/data.service';
import { effectiveFoodStatValue } from '@nanommo/shared';

export type DietEntry = { itemId: string; consumedAt: string; digestUntil: string; dietLevel: number };
export type DietLevelState = Record<string, { level: number; lastDigestUntil: string }>;

/** Canonicalize legacy duplicate entries without changing inventory or digestion eligibility. */
export function normalizeDietState(
  currentDiet: DietEntry[] | null | undefined,
  currentLevels: DietLevelState | null | undefined = {},
): { diet: DietEntry[]; dietLevels: DietLevelState } {
  const levels = currentLevels ?? {};
  const source = Array.isArray(currentDiet) ? currentDiet : [];
  const byId = new Map<string, DietEntry>();
  for (const raw of source) {
    if (!raw?.itemId) continue;
    const old = byId.get(raw.itemId);
    const oldTime = old ? Date.parse(old.consumedAt) || 0 : -1;
    const newTime = Date.parse(raw.consumedAt) || 0;
    const maxLevel = Math.max(0, Math.min(3, Number(raw.dietLevel ?? 0)), old?.dietLevel ?? 0);
    const latestDigest = [raw.digestUntil, old?.digestUntil].filter(Boolean).sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] ?? raw.digestUntil;
    if (!old || newTime >= oldTime) byId.set(raw.itemId, { ...raw, digestUntil: latestDigest, dietLevel: maxLevel });
    else { old.dietLevel = maxLevel; old.digestUntil = latestDigest; }
  }
  const diet = [...byId.values()].sort((a, b) => (Date.parse(a.consumedAt) || 0) - (Date.parse(b.consumedAt) || 0)).slice(-3);
  const retained = new Set(diet.map((entry) => entry.itemId));
  const dietLevels: DietLevelState = {};
  for (const [id, state] of Object.entries(levels)) {
    const digest = state?.lastDigestUntil;
    if (digest) dietLevels[id] = { level: retained.has(id) ? Math.max(0, Math.min(3, Number(state.level ?? 0))) : 0, lastDigestUntil: digest };
  }
  for (const entry of diet) {
    const prior = dietLevels[entry.itemId];
    const digest = [entry.digestUntil, prior?.lastDigestUntil].filter(Boolean).sort((a,b) => (Date.parse(b)||0)-(Date.parse(a)||0))[0] ?? entry.digestUntil;
    entry.digestUntil = digest;
    entry.dietLevel = Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0), 3), Number(prior?.level ?? 0));
    dietLevels[entry.itemId] = { level: entry.dietLevel, lastDigestUntil: digest };
  }
  return { diet, dietLevels };
}

export function buildDietStateAfterFoodConsumption(
  currentDiet: DietEntry[], itemId: string, consumedAt: string, digestUntil: string,
  currentLevels: DietLevelState = {},
): { diet: DietEntry[]; dietLevels: DietLevelState; nextLevel: number } {
  const normalized = normalizeDietState(currentDiet, currentLevels);
  const retainedEntry = normalized.diet.find((entry) => entry.itemId === itemId);
  const nextLevel = retainedEntry ? Math.min(3, Math.max(0, Number(retainedEntry.dietLevel ?? 0)) + 1) : 0;
  let entries = normalized.diet.slice();
  if (entries.length === 3) {
    const evicted = entries.shift()!;
    if (evicted.itemId !== itemId) normalized.dietLevels[evicted.itemId] = {
      level: 0,
      ...(normalized.dietLevels[evicted.itemId]?.lastDigestUntil ? { lastDigestUntil: normalized.dietLevels[evicted.itemId].lastDigestUntil } : { lastDigestUntil: evicted.digestUntil }),
    };
  }
  entries = entries.filter((entry) => entry.itemId !== itemId);
  entries.push({ itemId, consumedAt, digestUntil, dietLevel: nextLevel });
  const next = normalizeDietState(entries, {
    ...normalized.dietLevels,
    [itemId]: { level: nextLevel, lastDigestUntil: digestUntil },
  });
  // Consumption is authoritative for this item's digestion boundary.
  next.dietLevels[itemId] = { level: nextLevel, lastDigestUntil: digestUntil };
  const selected = next.diet.find((entry) => entry.itemId === itemId);
  if (selected) selected.digestUntil = digestUntil;
  return { ...next, nextLevel };
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
    @Optional() private readonly idleJournal?: IdleJournalService,
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
    await this.assertTownStorageAccess(characterId);
    return this.inventoryItemRepo.find({
      where: { characterId, location: 'warehouse' },
      order: { slotIndex: 'ASC' },
    });
  }

  /**
   * Get inventory item count for a specific item
   */
  async assertTownStorageAccess(characterId: string): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    const map = this.dataService.getMapById(character.currentMapId);
    if (map?.type !== 'town' || character.status !== 'town' || character.pendingMapTransition !== null || character.travelIntent != null) throw new BadRequestException('Warehouse is only available while settled in Town');
  }

  async getItemCount(characterId: string, itemId: string, manager?: EntityManager): Promise<number> {
    const repo = manager?.getRepository(InventoryItem) ?? this.inventoryItemRepo;
    const stacks = await repo.find({
      where: { characterId, itemId, location: 'inventory' },
    });
    return stacks.reduce((total, stack) => total + Math.max(0, Number(stack.quantity) || 0), 0);
  }

  /**
   * Move one persisted inventory row into a visual slot. Occupied targets swap;
   * empty targets leave the source slot empty. Character is locked first so this
   * layout revision is causally ordered with battle-resolution snapshots.
   */
  async moveItemToSlot(
    characterId: string,
    inventoryItemId: string,
    targetSlotIndex: number,
  ): Promise<{ items: InventoryItem[]; stateVersion: number; lastSeenAt: Date }> {
    if (!Number.isInteger(targetSlotIndex) || targetSlotIndex < 0 || targetSlotIndex >= 50) {
      throw new BadRequestException('Target slot must be between 0 and 49');
    }

    return this.inventoryItemRepo.manager.transaction(async (manager) => {
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('Character not found');

      const repo = manager.getRepository(InventoryItem);
      const rows = await repo.find({
        where: { characterId, location: 'inventory' },
        order: { slotIndex: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const source = rows.find((row) => row.id === inventoryItemId);
      if (!source) throw new NotFoundException('Inventory item not found');

      if (source.slotIndex !== targetSlotIndex) {
        const sourceSlotIndex = source.slotIndex;
        const target = rows.find((row) => row.slotIndex === targetSlotIndex);
        let merged = false;
        if (target && target.id !== source.id && target.itemId === source.itemId
          && JSON.stringify(target.instanceData ?? null) === JSON.stringify(source.instanceData ?? null)) {
          const definition = this.dataService.getItemById(source.itemId);
          const maxStack = Math.max(1, Math.floor(Number(definition?.maxStack ?? 1)));
          if (definition?.stackable === true && maxStack > 1) {
            const room = Math.max(0, maxStack - Number(target.quantity));
            const transfer = Math.min(room, Number(source.quantity));
            if (transfer > 0) {
              target.quantity = Number(target.quantity) + transfer;
              source.quantity = Number(source.quantity) - transfer;
              await repo.save(target);
              if (source.quantity === 0) await repo.remove(source);
              else await repo.save(source); // Overflow stays in the original source slot.
              merged = true;
            }
          }
        }
        const sourceDefinition = this.dataService.getItemById(source.itemId);
        if (!merged && target && target.itemId === source.itemId
          && JSON.stringify(target.instanceData ?? null) === JSON.stringify(source.instanceData ?? null)
          && sourceDefinition?.stackable === true && Number(sourceDefinition.maxStack ?? 1) > 1) {
          // Same compatible stack with no room: leave both rows in place, don't swap them.
        } else if (!merged && target) {
          // Use a guaranteed-free transient index to respect the unique slot constraint.
          source.slotIndex = Math.max(50, ...rows.map((row) => row.slotIndex + 1));
          await repo.save(source);
          target.slotIndex = sourceSlotIndex;
          await repo.save(target);
          source.slotIndex = targetSlotIndex;
          await repo.save(source);
        } else if (!merged) {
          source.slotIndex = targetSlotIndex;
          await repo.save(source);
        }
        character.lastSeenAt = new Date();
        const savedCharacter = await characterRepo.save(character);
        character.stateVersion = savedCharacter.stateVersion;
        character.lastSeenAt = savedCharacter.lastSeenAt;
      }

      return {
        items: await repo.find({
          where: { characterId, location: 'inventory' },
          order: { slotIndex: 'ASC' },
        }),
        stateVersion: character.stateVersion,
        lastSeenAt: character.lastSeenAt,
      };
    });
  }

  /** Split a stack into a new free inventory slot. All validation and both row mutations are atomic. */
  async splitStack(characterId: string, inventoryItemId: string, splitQuantity: number): Promise<{ items: InventoryItem[]; stateVersion: number; lastSeenAt: Date }> {
    try {
      return await this.inventoryItemRepo.manager.transaction(async (manager) => {
        const characterRepo = manager.getRepository(Character);
        const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
        if (!character) throw new NotFoundException('Character not found');
        const repo = manager.getRepository(InventoryItem);
        const rows = await repo.find({ where: { characterId, location: 'inventory' }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
        const source = rows.find(row => row.id === inventoryItemId);
        if (!source) throw new NotFoundException('Inventory stack not found; reload and retry');
        const definition = this.dataService.getItemById(source.itemId);
        if (definition?.stackable !== true || Number(definition.maxStack ?? 1) <= 1 || Number(source.quantity) <= 1) {
          throw new BadRequestException('This item cannot be split');
        }
        if (!Number.isInteger(splitQuantity) || splitQuantity < 1 || splitQuantity >= Number(source.quantity)) {
          throw new BadRequestException(`Split quantity must be between 1 and ${Number(source.quantity) - 1}`);
        }
        if (rows.length >= 50) throw new BadRequestException('Inventory is full; free a slot before splitting a stack');
        const used = new Set(rows.map(row => Number(row.slotIndex)));
        const freeSlot = Array.from({ length: 50 }, (_, index) => index).find(index => !used.has(index));
        if (freeSlot === undefined) throw new BadRequestException('Inventory is full; free a slot before splitting a stack');

        source.quantity = Number(source.quantity) - splitQuantity;
        await repo.save(source);
        const split = repo.create({
          characterId, location: 'inventory', slotIndex: freeSlot,
          itemId: source.itemId, quantity: splitQuantity,
          ...(source.instanceData == null ? {} : { instanceData: source.instanceData }),
        });
        await repo.save(split);
        character.lastSeenAt = new Date();
        const savedCharacter = await characterRepo.save(character);
        return {
          items: await repo.find({ where: { characterId, location: 'inventory' }, order: { slotIndex: 'ASC' } }),
          stateVersion: savedCharacter.stateVersion,
          lastSeenAt: savedCharacter.lastSeenAt,
        };
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown validation error';
      await this.idleJournal?.record(characterId, `Inventory split failed: ${reason}`, undefined, 'error');
      throw error;
    }
  }

  /**
   * Persist the complete inventory order supplied by the client. The submitted IDs
   * must exactly match the current inventory to prevent stale requests from losing rows.
   * Slots are staged above the 0–49 range before compact indexes are assigned.
   */
  async sortInventory(
    characterId: string,
    orderedItemIds: string[],
  ): Promise<{ items: InventoryItem[]; stateVersion: number; lastSeenAt: Date }> {
    if (!Array.isArray(orderedItemIds) || orderedItemIds.length > 50
      || orderedItemIds.some((id) => typeof id !== 'string' || !id)
      || new Set(orderedItemIds).size !== orderedItemIds.length) {
      throw new BadRequestException('Invalid inventory order');
    }

    return this.inventoryItemRepo.manager.transaction(async (manager) => {
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('Character not found');

      const repo = manager.getRepository(InventoryItem);
      const rows = await repo.find({
        where: { characterId, location: 'inventory' },
        order: { slotIndex: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const rowById = new Map(rows.map((row) => [row.id, row]));
      if (orderedItemIds.length !== rows.length || rows.some((row) => !orderedItemIds.includes(row.id))
        || orderedItemIds.some((id) => !rowById.has(id))) {
        throw new BadRequestException('Inventory changed; reload and retry sorting');
      }

      const alreadyCompact = orderedItemIds.every((id, index) => {
        const row = rowById.get(id);
        return row?.slotIndex === index;
      });

      if (!alreadyCompact) {
        for (const row of rows) row.slotIndex += 50;
        await repo.save(rows);

        orderedItemIds.forEach((id, index) => {
          const row = rowById.get(id)!;
          row.slotIndex = index;
        });
        await repo.save(orderedItemIds.map((id) => rowById.get(id)!));

        character.lastSeenAt = new Date();
        const savedCharacter = await characterRepo.save(character);
        character.stateVersion = savedCharacter.stateVersion;
        character.lastSeenAt = savedCharacter.lastSeenAt;
      }

      return {
        items: await repo.find({
          where: { characterId, location: 'inventory' },
          order: { slotIndex: 'ASC' },
        }),
        stateVersion: character.stateVersion,
        lastSeenAt: character.lastSeenAt,
      };
    });
  }

  /**
   * Check if location has free slots
   */
  private async getFreeSlots(
    characterId: string,
    location: 'inventory' | 'warehouse',
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager?.getRepository(InventoryItem) ?? this.inventoryItemRepo;
    const maxSlots = location === 'inventory' ? 50 : 10;
    const usedSlots = await repo.count({
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
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager?.getRepository(InventoryItem) ?? this.inventoryItemRepo;
    const maxSlots = location === 'inventory' ? 50 : 10;
    const items = await repo.find({
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
   * Add item(s) only to the explicitly requested location.
   */
  async addItem(
    characterId: string,
    itemId: string,
    quantity: number,
    location: 'inventory' | 'warehouse' = 'inventory',
    instanceData?: any,
    manager?: EntityManager,
    allowCookingReservation = false,
  ): Promise<InventoryItem> {
    if (location !== 'inventory') throw new BadRequestException('Warehouse items can only be created by an explicit Storage transfer');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequestException('Quantity must be a positive integer');
    const inventoryRepo = manager?.getRepository(InventoryItem) ?? this.inventoryItemRepo;
    const item = this.dataService.getItemById(itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    if (!allowCookingReservation) {
      const character = await (manager?.getRepository(Character) ?? this.characterRepo).findOne({ where: { id: characterId }, lock: manager ? { mode: 'pessimistic_write' } : undefined });
      const session = character?.cookingSession;
      if (session) {
        const rows = await inventoryRepo.find({ where: { characterId, location: 'inventory' } });
        const projected = rows.map(row => ({ itemId: row.itemId, quantity: Number(row.quantity) }));
        let remainingGrant = quantity;
        if (item.stackable) for (const row of projected.filter(row => row.itemId === itemId)) { const add = Math.min(remainingGrant, Math.max(0, Number(item.maxStack ?? 1) - row.quantity)); row.quantity += add; remainingGrant -= add; }
        while (remainingGrant > 0) { const add = item.stackable ? Math.min(remainingGrant, Number(item.maxStack ?? remainingGrant)) : 1; projected.push({ itemId, quantity: add }); remainingGrant -= add; }
        const output = this.dataService.getItemById(session.outputItemId);
        const outputCanMerge = !!output?.stackable && projected.some(row => row.itemId === output.id && row.quantity < Number(output.maxStack ?? 1));
        if (!outputCanMerge && projected.length >= 50) throw new BadRequestException('Inventory space is reserved for your active Cooking session');
      }
    }

    let remaining = quantity;
    let lastItem: InventoryItem;

    // Try to add to existing stack if stackable
    if (item.stackable && item.maxStack && item.maxStack > 1) {
      const existingStacks = await inventoryRepo.find({
        where: { characterId, location, itemId },
      });

      for (const stack of existingStacks) {
        const space = item.maxStack - stack.quantity;
        if (space > 0) {
          const toAdd = Math.min(remaining, space);
          stack.quantity += toAdd;
          lastItem = await inventoryRepo.save(stack);
          remaining -= toAdd;

          if (remaining === 0) {
            await this.markItemKnown(characterId, itemId, manager);
            return lastItem;
          }
        }
      }
    }

    // Try to create new slot for remaining quantity
    if (remaining > 0) {
      const freeSlots = await this.getFreeSlots(characterId, location, manager);

      if (freeSlots === 0) {
        throw new BadRequestException(location === 'inventory' ? 'Inventory is full' : 'Warehouse is full');
      }

      // Split remaining into stacks if needed
      while (remaining > 0) {
        const slot = await this.getNextSlot(characterId, location, manager);
        const stackSize = item.stackable
          ? Math.min(remaining, item.maxStack || remaining)
          : 1;

        const newItem = inventoryRepo.create({
          characterId,
          location,
          slotIndex: slot,
          itemId,
          quantity: stackSize,
          instanceData: instanceData || null,
        });

        lastItem = await inventoryRepo.save(newItem);
        remaining -= stackSize;

        if (remaining === 0) {
          await this.markItemKnown(characterId, itemId, manager);
          return lastItem;
        }
      }
    }

    // All items added successfully
    if (remaining === 0) {
      // If lastItem was set during stacking or creation, return it
      if (lastItem) {
        await this.markItemKnown(characterId, itemId, manager);
        return lastItem;
      }
      // Fallback: fetch the most recently added item
      const recentItem = await inventoryRepo.findOne({
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
   * First successful item grant makes the catalogue entry known for Gambits.
   * Battle transactions update their already-loaded Character instance in
   * BattleService instead, preventing a stale entity save from overwriting it.
   */
  private async markItemKnown(characterId: string, itemId: string, manager?: EntityManager): Promise<void> {
    if (manager) return;
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) return;
    const known = Array.isArray(character.knownItemIds) ? character.knownItemIds : [];
    if (known.includes(itemId)) return;
    character.knownItemIds = [...known, itemId];
    await this.characterRepo.save(character);
  }

  /**
   * Remove item(s) from inventory
   */
  async removeItem(
    characterId: string,
    itemId: string,
    quantity: number,
    manager?: EntityManager,
    allowCookingReservation = false,
  ): Promise<void> {
    const inventoryRepo = manager?.getRepository(InventoryItem) ?? this.inventoryItemRepo;
    if (!allowCookingReservation) {
      const character = await (manager?.getRepository(Character) ?? this.characterRepo).findOne({ where: { id: characterId }, lock: manager ? { mode: 'pessimistic_write' } : undefined });
      const reserved = (character?.cookingSession?.ingredients ?? []).filter((row: any) => row.itemId === itemId).reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
      const owned = await inventoryRepo.find({ where: { characterId, itemId, location: 'inventory' } });
      if (owned.reduce((sum, row) => sum + Number(row.quantity), 0) - quantity < reserved) throw new BadRequestException('Items are reserved for your active Cooking session');
    }
    let remaining = quantity;

    // Find and remove from stacks
    const items = await inventoryRepo.find({
      where: { characterId, itemId, location: 'inventory' },
      order: { slotIndex: 'ASC' },
    });

    for (const item of items) {
      if (remaining === 0) break;

      const toRemove = Math.min(remaining, item.quantity);
      item.quantity -= toRemove;
      remaining -= toRemove;

      if (item.quantity <= 0) {
        await inventoryRepo.remove(item);
      } else {
        await inventoryRepo.save(item);
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
    characterId: string, itemId: string, quantity: number,
    fromLocation: 'inventory' | 'warehouse', toLocation: 'inventory' | 'warehouse',
  ): Promise<InventoryItem> {
    return this.inventoryItemRepo.manager.transaction(async manager => {
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      const map = this.dataService.getMapById(character.currentMapId);
      if (map?.type !== 'town' || character.status !== 'town' || character.pendingMapTransition !== null || character.travelIntent != null) throw new BadRequestException('Warehouse is only available while settled in Town');
      const repo = manager.getRepository(InventoryItem);
      if (fromLocation === 'inventory' && character.cookingSession) {
        const reserved = (character.cookingSession.ingredients ?? []).filter((row: any) => row.itemId === itemId).reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
        const ownedRows = await repo.find({ where: { characterId, itemId, location: 'inventory' } });
        if (ownedRows.reduce((sum, row) => sum + Number(row.quantity), 0) - quantity < reserved) throw new BadRequestException('Items are reserved for your active Cooking session');
      }
      const candidates = await repo.find({ where: { characterId, itemId, location: fromLocation }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      const matching = candidates.filter(row => Number(row.quantity) === quantity);
      if (matching.length !== 1) throw new BadRequestException(matching.length > 1 ? 'Ambiguous source stack; use the row-ID transfer endpoint' : 'Transfer must move one complete stack; reload and retry');
      return this.transferLockedRow(manager, matching[0], toLocation);
    });
  }

  async transferInventoryRow(characterId: string, sourceRowId: string, fromLocation: 'inventory' | 'warehouse', toLocation: 'inventory' | 'warehouse'): Promise<InventoryItem> {
    if (fromLocation === toLocation) throw new BadRequestException('Source and destination must be different');
    return this.inventoryItemRepo.manager.transaction(async manager => {
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      const map = this.dataService.getMapById(character.currentMapId);
      if (map?.type !== 'town' || character.status !== 'town' || character.pendingMapTransition !== null || character.travelIntent != null) throw new BadRequestException('Warehouse is only available while settled in Town');
      const repo = manager.getRepository(InventoryItem);
      const source = await repo.findOne({ where: { id: sourceRowId, characterId, location: fromLocation }, lock: { mode: 'pessimistic_write' } });
      if (!source) throw new NotFoundException('Source stack not found at expected location');
      if (fromLocation === 'inventory' && character.cookingSession) {
        const reserved = (character.cookingSession.ingredients ?? []).filter((row: any) => row.itemId === source.itemId).reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
        const ownedRows = await repo.find({ where: { characterId, itemId: source.itemId, location: 'inventory' } });
        if (ownedRows.reduce((sum, row) => sum + Number(row.quantity), 0) - Number(source.quantity) < reserved) throw new BadRequestException('Items are reserved for your active Cooking session');
      }
      return this.transferLockedRow(manager, source, toLocation);
    });
  }

  private async transferLockedRow(manager: EntityManager, source: InventoryItem, toLocation: 'inventory' | 'warehouse'): Promise<InventoryItem> {
    const repo = manager.getRepository(InventoryItem);
    const item = this.dataService.getItemById(source.itemId);
    if (!item) throw new NotFoundException('Item definition not found');
    const stackable = item.stackable === true && Number(item.maxStack ?? 1) > 1;
    const maxStack = Math.max(1, Math.floor(Number(item.maxStack ?? 1)));
    if (!Number.isInteger(Number(source.quantity)) || Number(source.quantity) < 1 || (!stackable && Number(source.quantity) !== 1) || (stackable && Number(source.quantity) > maxStack)) {
      throw new BadRequestException('Source stack violates the item stacking rules');
    }
    const maxSlots = toLocation === 'inventory' ? 50 : 10;
    if (!Number.isInteger(Number(source.slotIndex)) || source.slotIndex < 0 || source.slotIndex >= (source.location === 'inventory' ? 50 : 10)) {
      throw new BadRequestException('Source stack has an invalid slot index; reload and retry');
    }
    const destRows = await repo.find({ where: { characterId: source.characterId, location: toLocation }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
    const used = new Set<number>();
    for (const row of destRows) {
      const index = Number(row.slotIndex);
      if (!Number.isInteger(index) || index < 0 || index >= maxSlots || used.has(index)) {
        throw new BadRequestException('Destination slot layout is invalid; reload and retry');
      }
      used.add(index);
    }
    if (stackable) {
      const merge = destRows.find(row => row.itemId === source.itemId && JSON.stringify(row.instanceData ?? null) === JSON.stringify(source.instanceData ?? null) && Number(row.quantity) >= 1 && Number(row.quantity) + Number(source.quantity) <= maxStack);
      if (merge) { merge.quantity += source.quantity; await repo.save(merge); await repo.remove(source); return merge; }
    }
    const slot = Array.from({ length: maxSlots }, (_, i) => i).find(i => !used.has(i));
    if (slot === undefined) throw new BadRequestException(toLocation === 'inventory' ? 'Inventory is full' : 'Warehouse is full');
    source.location = toLocation; source.slotIndex = slot;
    return repo.save(source);
  }

  async transferToWarehouse(characterId: string, itemId: string, quantity: number): Promise<InventoryItem> {
    return this.transferItem(characterId, itemId, quantity, 'inventory', 'warehouse');
  }

  async transferFromWarehouse(characterId: string, itemId: string, quantity: number): Promise<InventoryItem> {
    return this.transferItem(characterId, itemId, quantity, 'warehouse', 'inventory');
  }

  async consumeFood(characterId: string, itemId: string, manager?: EntityManager, consumeInventory = true, journal = true): Promise<Character> {
    const item = this.dataService.getItemById(itemId);
    if (!item || item.type !== 'food' || item.effect?.type !== 'food_buff') {
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
      const normalizedDiet = normalizeDietState(character.diet, character.dietLevels);
      const diet = normalizedDiet.diet;
      character.diet = normalizedDiet.diet;
      character.dietLevels = normalizedDiet.dietLevels;
      const previousDigestUntil = Date.parse(character.dietLevels?.[itemId]?.lastDigestUntil ?? '') || 0;
      if (previousDigestUntil > now) throw new BadRequestException('Food is still digesting');

      const consumedAt = new Date(now).toISOString();
      const digestUntil = new Date(now + Number(item.effect?.durationSeconds ?? 0) * 1000).toISOString();
      const dietState = buildDietStateAfterFoodConsumption(diet, itemId, consumedAt, digestUntil, character.dietLevels);

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
      if (journal && this.idleJournal) {
        await this.idleJournal.ate(characterId, String(item.name ?? itemId), `manual-food:${characterId}:${itemId}:${saved.lastSeenAt?.getTime() ?? Date.now()}`);
      }
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
    if (!item || !['consumable', 'food'].includes(item.type)) {
      throw new BadRequestException('Item is not a usable item');
    }

    const result = await this.characterRepo.manager.transaction(async (manager) => {
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');

      const now = Date.now();
      const startedBattle = await manager.getRepository(BattleQueueEntry).createQueryBuilder('battle')
        .where('battle."characterId" = :characterId', { characterId })
        .andWhere('battle."resolved" = false')
        .andWhere('battle."startAt" <= :now', { now: new Date(now) })
        .getOne();
      if (startedBattle) {
        throw new BadRequestException('Consumables can only be used outside battle');
      }

      const count = await this.getItemCount(characterId, itemId, manager);
      if (count <= 0) throw new BadRequestException('Insufficient item quantity');

      const effect = item.effect ?? {};
      if (item.type === 'food' && effect.type === 'food_buff') {
        // Keep all existing diet/digestion/streak/reservation validation in the
        // canonical consumeFood transaction; do not add a second food cooldown.
        const updated = await this.consumeFood(characterId, itemId, manager, true, false);
        return { character: updated, itemId, usedFood: true };
      }

      const effectType = String(effect.type ?? '');
      const isPotion = item.type === 'consumable' && ['heal_hp', 'heal_sp', 'heal_hp_sp'].includes(effectType);
      const configuredCooldown = Number(item.cooldownInSeconds ?? item.cooldownSeconds ?? (isPotion ? 5 : 0));
      const cooldownKey = isPotion ? 'item:potion' : configuredCooldown > 0 ? `item:${itemId}` : null;
      const cooldowns = { ...(character.consumableCooldowns ?? {}) };
      if (cooldownKey) {
        const expiresAt = Date.parse(String(cooldowns[cooldownKey] ?? ''));
        if (Number.isFinite(expiresAt) && expiresAt > now) {
          const secondsRemaining = Math.ceil((expiresAt - now) / 1000);
          throw new BadRequestException(`Item is on cooldown (${secondsRemaining}s remaining)`);
        }
      }

      character.lastSeenAt = new Date(now);
      if (effectType === 'heal_hp') {
        const derived = await this.getDerivedStatsForCharacter(character);
        character.hpCurrent = Math.min(derived.maxHp, Number(character.hpCurrent) + Number(effect.amount ?? 0));
      } else if (effectType === 'heal_sp') {
        const derived = await this.getDerivedStatsForCharacter(character);
        character.spCurrent = Math.min(derived.maxSp, Number(character.spCurrent) + Number(effect.amount ?? 0));
      } else if (effectType === 'heal_hp_sp') {
        const derived = await this.getDerivedStatsForCharacter(character);
        character.hpCurrent = Math.min(derived.maxHp, Number(character.hpCurrent) + Number(effect.hpAmount ?? 0));
        character.spCurrent = Math.min(derived.maxSp, Number(character.spCurrent) + Number(effect.spAmount ?? 0));
      } else if (effectType === 'cure_status' && effect.status) {
        character.statusEffects = (character.statusEffects ?? []).filter((status: any) => (status.type ?? status.id) !== effect.status);
      }

      // Persist absolute deadlines so the cooldown keeps elapsing outside battle
      // and can seed the next immutable battle snapshot if combat starts early.
      if (cooldownKey && configuredCooldown > 0) {
        for (const [key, until] of Object.entries(cooldowns)) {
          const timestamp = Date.parse(String(until));
          if (!Number.isFinite(timestamp) || timestamp <= now) delete cooldowns[key];
        }
        cooldowns[cooldownKey] = new Date(now + configuredCooldown * 1000).toISOString();
        character.consumableCooldowns = cooldowns;
      }

      await this.removeItem(characterId, itemId, 1, manager);
      const saved = await characterRepo.save(character);
      return { character: saved, itemId, usedFood: false };
    });

    if (result.usedFood && this.idleJournal) {
      await this.idleJournal.ate(characterId, String(item.name ?? itemId), `manual-food:${characterId}:${itemId}:${result.character.lastSeenAt?.getTime() ?? Date.now()}`);
    }
    return { character: result.character, itemId: result.itemId };
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
      str: character.str, agi: character.agi, dex: character.dex, vit: character.vit, int: character.int, luk: character.luk,
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
    const foods = consumables.filter((item: any) => item?.type === 'food' && item?.effect?.type === 'food_buff');
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

  /** Preflight an entire battle drop before any inventory stack is mutated. */
  async canFitInventoryDrop(characterId: string, itemId: string, quantity: number, manager: EntityManager): Promise<boolean> {
    if (!Number.isInteger(quantity) || quantity <= 0) return false;
    const item = this.dataService.getItemById(itemId);
    if (!item) return false;
    const repo = manager.getRepository(InventoryItem);
    const rows = await repo.find({ where: { characterId, location: 'inventory' }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
    const freeSlots = Math.max(0, 50 - rows.length);
    if (!item.stackable || Number(item.maxStack ?? 1) <= 1) return quantity <= freeSlots;
    let remaining = quantity;
    const maxStack = Number(item.maxStack);
    for (const row of rows) {
      if (row.itemId !== itemId) continue;
      remaining -= Math.max(0, maxStack - Number(row.quantity));
      if (remaining <= 0) return true;
    }
    return Math.ceil(remaining / maxStack) <= freeSlots;
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
