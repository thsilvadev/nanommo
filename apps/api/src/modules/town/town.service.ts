import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { DataService } from '../data/data.service';
import { InventoryService } from '../inventory/inventory.service';
import { CharacterService } from '../character/character.service';
import { TOWN_MAP_ID } from '@nanommo/shared';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { BattleService } from '../battle/battle.service';

const GOLD_CAP = 1_000_000_000_000;
const INVENTORY_SLOTS = 50;

type VendorItem = { itemId: string; price?: number; priceFromItem?: boolean; infiniteStock?: boolean; quantity?: number };
type Vendor = { id: string; name: string; type: 'vendor'; location: 'town'; buysAnyItem: boolean; buyRatePercent: number; sellStock: VendorItem[] };

@Injectable()
export class TownService {
  constructor(
    @InjectRepository(Character) private readonly characterRepo: Repository<Character>,
    @InjectRepository(InventoryItem) private readonly inventoryRepo: Repository<InventoryItem>,
    private readonly dataService: DataService,
    private readonly inventoryService: InventoryService,
    private readonly characterService: CharacterService,
    private readonly battleService: BattleService,
    @InjectQueue('battle-queue') private readonly bullQueue: Queue,
  ) {}

  private vendor(vendorId = 'william'): Vendor {
    if (vendorId === 'william') {
      const raw = this.dataService.getNpcVendor();
      if (!raw || raw.location !== 'town') throw new NotFoundException('Vendor catalog unavailable');
      return {
        id: String(raw.id), name: String(raw.name), type: 'vendor', location: 'town',
        buysAnyItem: Boolean(raw.buysAnyItem), buyRatePercent: Number(raw.buyRatePercent ?? 0),
        sellStock: Array.isArray(raw.sellStock) ? raw.sellStock : [],
      };
    }
    const raw = this.npcCatalog().find((x: any) => x.id === vendorId && x.location === 'town' && Array.isArray(x.types) && x.types.includes('vendor'));
    if (!raw?.vendor) throw new NotFoundException('Vendor not found');
    return {
      id: String(raw.id), name: String(raw.name), type: 'vendor', location: 'town',
      buysAnyItem: Boolean(raw.vendor.buysAnyItem), buyRatePercent: Number(raw.vendor.buyRatePercent ?? 0),
      sellStock: Array.isArray(raw.vendor.sellStock) ? raw.vendor.sellStock : [],
    };
  }

  private assertPositiveInteger(quantity: number) {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequestException('Quantity must be a positive integer');
  }

  private item(itemId: string): any {
    const item = this.dataService.getItemById(itemId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    return item;
  }

  private buyPrice(vendor: Vendor, itemId: string): number {
    const entry = vendor.sellStock.find(x => x.itemId === itemId);
    if (!entry) throw new BadRequestException('Item is not sold by this vendor');
    const price = entry.priceFromItem ? Number(this.item(itemId).marketBasePrice ?? this.item(itemId).sellPriceToVendor ?? 0) : Number(entry.price);
    if (!Number.isSafeInteger(price) || price <= 0) throw new BadRequestException('Vendor price is invalid');
    return price;
  }

  private sellPrice(vendor: Vendor, itemId: string): number {
    if (!vendor.buysAnyItem) throw new BadRequestException('Vendor does not buy items');
    const item = this.item(itemId);
    const base = Number(item.marketBasePrice ?? item.sellPriceToVendor ?? 0);
    const price = Math.floor(base * vendor.buyRatePercent / 100);
    if (!Number.isSafeInteger(price) || price <= 0) throw new BadRequestException('Item has no valid vendor sell value');
    return price;
  }

  private async characterForTown(manager: EntityManager, characterId: string): Promise<Character> {
    const character = await manager.getRepository(Character).findOne({
      where: { id: characterId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!character) throw new NotFoundException('Character not found');
    if (this.dataService.getMapById(character.currentMapId)?.type !== 'town' || character.pendingMapTransition !== null || character.travelIntent != null || character.status !== 'town') throw new BadRequestException('Town transactions are only available in Town');
    return character;
  }

  private async inventoryCapacity(manager: EntityManager, characterId: string, itemId: string, quantity: number): Promise<boolean> {
    const item = this.item(itemId);
    const rows = await manager.getRepository(InventoryItem).find({ where: { characterId, location: 'inventory', itemId }, lock: { mode: 'pessimistic_write' } });
    let remaining = quantity;
    if (item.stackable) {
      for (const row of rows) remaining = Math.max(0, remaining - Math.max(0, Number(item.maxStack ?? remaining) - row.quantity));
    }
    if (remaining <= 0) return true;
    const used = await manager.getRepository(InventoryItem).count({ where: { characterId, location: 'inventory' } });
    const slotsNeeded = item.stackable ? Math.ceil(remaining / Number(item.maxStack ?? remaining)) : remaining;
    return used + slotsNeeded <= INVENTORY_SLOTS;
  }

  private async addInventoryAtomic(manager: EntityManager, characterId: string, itemId: string, quantity: number) {
    const character = await manager.getRepository(Character).findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
    const active = character?.cookingSession;
    if (active) {
      const output = this.item(active.outputItemId);
      const rows = await manager.getRepository(InventoryItem).find({ where: { characterId, location: 'inventory' } });
      const granted = this.item(itemId);
      const rowCountAfter = rows.length + (granted.stackable && rows.some(row => row.itemId === itemId && row.quantity < Number(granted.maxStack ?? 1)) ? 0 : Math.ceil(quantity / Number(granted.maxStack ?? 1)));
      const outputCanMerge = output.stackable && rows.some(row => row.itemId === output.id && row.quantity < Number(output.maxStack ?? 1)) && !(itemId === output.id && rowCountAfter > rows.length);
      if (!outputCanMerge && rowCountAfter >= INVENTORY_SLOTS) throw new BadRequestException('Inventory space is reserved for your active Cooking session');
    }
    const item = this.item(itemId);
    let remaining = quantity;
    const repo = manager.getRepository(InventoryItem);
    const rows = await repo.find({ where: { characterId, location: 'inventory', itemId }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
    if (item.stackable) {
      for (const row of rows) {
        const room = Number(item.maxStack ?? 1) - row.quantity;
        if (room <= 0) continue;
        const add = Math.min(room, remaining);
        row.quantity += add;
        await repo.save(row);
        remaining -= add;
        if (remaining === 0) return;
      }
    }
    while (remaining > 0) {
      const usedRows = await repo.find({ where: { characterId, location: 'inventory' }, order: { slotIndex: 'ASC' } });
      const used = new Set(usedRows.map(x => x.slotIndex));
      const slot = Array.from({ length: INVENTORY_SLOTS }, (_, i) => i).find(i => !used.has(i));
      if (slot === undefined) throw new BadRequestException('Inventory is full');
      const add = item.stackable ? Math.min(remaining, Number(item.maxStack ?? remaining)) : 1;
      await repo.save(repo.create({ characterId, location: 'inventory', slotIndex: slot, itemId, quantity: add, instanceData: null }));
      remaining -= add;
    }
  }

  private async removeInventoryAtomic(manager: EntityManager, characterId: string, itemId: string, quantity: number, sourceInventoryItemId?: string) {
    const character = await manager.getRepository(Character).findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
    const reservation = character?.cookingSession?.ingredients?.filter((row: any) => row.itemId === itemId).reduce((sum: number, row: any) => sum + Number(row.quantity), 0) ?? 0;
    const repo = manager.getRepository(InventoryItem);
    const rows = await repo.find({ where: { characterId, location: 'inventory', itemId }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
    const owned = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (owned < quantity) throw new BadRequestException('Insufficient item quantity');
    if (owned - quantity < reservation) throw new BadRequestException('Items are reserved for your active Cooking session');

    if (sourceInventoryItemId) {
      const source = rows.find(row => row.id === sourceInventoryItemId);
      if (!source) throw new BadRequestException('Selected inventory stack no longer exists; reload and retry');
      if (quantity > Number(source.quantity)) throw new BadRequestException('Sale quantity exceeds the selected stack');
      source.quantity -= quantity;
      if (source.quantity === 0) await repo.remove(source); else await repo.save(source);
      return;
    }

    let remaining = quantity;
    for (const row of rows) {
      const remove = Math.min(remaining, row.quantity);
      row.quantity -= remove;
      remaining -= remove;
      if (row.quantity === 0) await repo.remove(row); else await repo.save(row);
      if (remaining === 0) break;
    }
  }

  async getVendorCatalog(characterId: string) {
    return (await this.getTownNPCs(characterId)).filter((npc: any) => npc.types.includes('vendor'));
  }

  async getVendorStock(characterId: string, vendorId: string) {
    await this.assertTown(characterId);
    const v = this.vendor(vendorId);
    if (vendorId !== v.id) throw new NotFoundException('Vendor not found');
    return v.sellStock.map((entry, index) => ({
      slotIndex: index,
      itemId: entry.itemId,
      quantity: entry.infiniteStock ? null : Number(entry.quantity ?? 0),
      infiniteStock: Boolean(entry.infiniteStock),
      buyPrice: this.buyPrice(v, entry.itemId),
      item: this.item(entry.itemId),
    }));
  }

  async getVendorQuote(characterId: string, vendorId: string, itemId: string) {
    await this.assertTown(characterId);
    const v = this.vendor(vendorId);
    if (vendorId !== v.id) throw new NotFoundException('Vendor not found');
    const item = this.item(itemId);
    const buyEntry = v.sellStock.find(x => x.itemId === itemId);
    return {
      vendorId: v.id,
      itemId,
      buyPrice: buyEntry ? this.buyPrice(v, itemId) : null,
      sellPrice: v.buysAnyItem ? this.sellPrice(v, itemId) : null,
      stackable: Boolean(item.stackable),
      maxStack: Number(item.maxStack ?? 1),
    };
  }

  async buyFromVendor(characterId: string, vendorId: string, itemId: string, quantity: number) {
    this.assertPositiveInteger(quantity);
    const v = this.vendor(vendorId);
    const item = this.item(itemId);
    if (!item.stackable && quantity !== 1) throw new BadRequestException('Non-stackable items can only be bought one at a time');
    const unitPrice = this.buyPrice(v, itemId);
    const total = unitPrice * quantity;
    if (!Number.isSafeInteger(total)) throw new BadRequestException('Transaction total is invalid');

    return this.characterRepo.manager.transaction(async manager => {
      const character = await this.characterForTown(manager, characterId);
      if (Number(character.gold) < total) throw new BadRequestException('Not enough gold');
      const stock = v.sellStock.find(x => x.itemId === itemId)!;
      if (!stock.infiniteStock && Number(stock.quantity ?? 0) < quantity) throw new BadRequestException('Not enough vendor stock');
      if (!(await this.inventoryCapacity(manager, characterId, itemId, quantity))) throw new BadRequestException('Inventory is full');
      character.gold = Number(character.gold) - total;
      await manager.getRepository(Character).save(character);
      await this.addInventoryAtomic(manager, characterId, itemId, quantity);
      return { goldSpent: total, unitPrice, quantity, itemId };
    });
  }

  async sellToVendor(characterId: string, vendorId: string, itemId: string, quantity: number, sourceInventoryItemId?: string) {
    this.assertPositiveInteger(quantity);
    const v = this.vendor(vendorId);
    const item = this.item(itemId);
    if (item.questOnly === true) throw new BadRequestException('Quest-only items cannot be sold to vendors');
    if (!item.stackable && quantity !== 1) throw new BadRequestException('Non-stackable items can only be sold one at a time');
    const unitPrice = this.sellPrice(v, itemId);
    const total = unitPrice * quantity;
    if (!Number.isSafeInteger(total)) throw new BadRequestException('Transaction total is invalid');

    return this.characterRepo.manager.transaction(async manager => {
      const character = await this.characterForTown(manager, characterId);
      await this.removeInventoryAtomic(manager, characterId, itemId, quantity, sourceInventoryItemId);
      character.gold = Math.min(Number(character.gold) + total, GOLD_CAP);
      await manager.getRepository(Character).save(character);
      return { goldReceived: total, unitPrice, quantity, itemId };
    });
  }

  private npcCatalog() {
    const raw = this.dataService.getNpcCatalog();
    if (!raw || !Array.isArray(raw.npcs)) throw new NotFoundException('NPC catalog unavailable');
    return raw.npcs;
  }

  private npc(npcId: string): any {
    const npc = this.npcCatalog().find((x: any) => x.id === npcId && x.location === 'town');
    if (!npc) throw new NotFoundException('NPC not found');
    return npc;
  }

  private async assertTown(characterId: string): Promise<Character> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    if (this.dataService.getMapById(character.currentMapId)?.type !== 'town' || character.pendingMapTransition !== null || character.travelIntent != null || character.status !== 'town') throw new BadRequestException('NPC interactions are only available in Town');
    return character;
  }

  private npcPublic(npc: any) {
    const types = Array.isArray(npc.types) ? npc.types : [];
    return { id: npc.id, name: npc.name, location: npc.location, types, greeting: npc.greeting ?? npc.vendor?.greeting, monologue: npc.monologue };
  }

  async getTownNPCs(characterId: string) {
    const character = await this.assertTown(characterId);
    const map = this.dataService.getMapById(character.currentMapId);
    const ids: string[] = Array.isArray(map?.npcIds) ? map.npcIds : (character.currentMapId === TOWN_MAP_ID ? ['william', ...this.npcCatalog().map((npc: any) => npc.id)] : []);
    return ids.map(id => {
      if (id === 'william') { const william = this.vendor(); return { id: william.id, name: william.name, location: william.location, types: ['vendor'], greeting: this.dataService.getNpcVendor()?.greeting }; }
      const npc = this.npcCatalog().find((entry: any) => entry.id === id && entry.location === 'town');
      return npc ? this.npcPublic(npc) : null;
    }).filter(Boolean);
  }

  private questNode(npc: any, nodeId?: string) {
    const quest = npc.dialogue;
    if (!quest?.nodes) throw new BadRequestException('NPC does not provide dialogue');
    const id = nodeId ?? quest.entryNodeId;
    const node = quest.nodes[id];
    if (!node) throw new NotFoundException('Dialogue node not found');
    return { id, ...node };
  }

  private characterHungry(character: Character) {
    const expiry = character.activeFoodBuff?.expiresAt ? Date.parse(String(character.activeFoodBuff.expiresAt)) : 0;
    return !expiry || expiry <= Date.now();
  }

  private async choiceAvailable(choice: any, character: Character) {
    if (!choice.condition) return true;
    if (choice.condition.type === 'hungry') return this.characterHungry(character);
    if (choice.condition.type === 'not_hungry') return !this.characterHungry(character);
    if (choice.condition.type === 'has_items' || choice.condition.type === 'not_has_items') {
      const requirements = Array.isArray(choice.condition.items) ? choice.condition.items : [];
      const rows = await this.inventoryRepo.find({ where: { characterId: character.id, location: 'inventory' } });
      const hasAll = requirements.every((req: any) => rows.filter(r => r.itemId === req.itemId).reduce((n, r) => n + Number(r.quantity ?? 0), 0) >= Number(req.quantity ?? 0));
      return choice.condition.type === 'has_items' ? hasAll : !hasAll;
    }
    return false;
  }

  private async dialogueState(character: Character, npcId: string, nodeId?: string) {
    const npc = this.npc(npcId);
    if (!Array.isArray(npc.types) || !npc.types.includes('dialogue')) throw new BadRequestException('NPC does not provide dialogue');
    const node = this.questNode(npc, nodeId);
    return {
      npcId,
      nodeId: node.id,
      npcText: node.npcText,
      choices: (await Promise.all((node.choices ?? []).map(async (choice: any) => ({ choice, available: await this.choiceAvailable(choice, character) })))).filter(x => x.available).map(x => x.choice)
        .map((choice: any) => ({ id: choice.id, text: choice.text, nextNodeId: choice.nextNodeId })),
    };
  }

  async getNpcDialogue(characterId: string, npcId: string) {
    const character = await this.assertTown(characterId);
    if (npcId === 'father_marcelus') {
      const derived = await this.characterService.getDerivedStatsForCharacter(character);
      character.hpCurrent = derived.maxHp;
      character.spCurrent = derived.maxSp;
      character.lastSeenAt = new Date();
      await this.characterRepo.save(character);
    }
    return this.dialogueState(character, npcId);
  }

  private async consumeFoodForNpc(manager: EntityManager, character: Character) {
    // Marcelus provides the bread directly, so it is a Diet consumption without
    // removing an inventory item. The same authoritative Diet/buff/digestion
    // implementation is used by normal inventory food consumption.
    await this.inventoryService.consumeFood(character.id, 'food_bread', manager, false);
    return 'food_bread';
  }

  async chooseNpcDialogue(characterId: string, npcId: string, choiceId: string, nodeId = 'greeting') {
    const npc = this.npc(npcId);
    if (!Array.isArray(npc.types) || !npc.types.includes('dialogue')) throw new BadRequestException('NPC does not provide dialogue');

    return this.characterRepo.manager.transaction(async manager => {
      const character = await manager.getRepository(Character).findOne({
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('Character not found');
      if (this.dataService.getMapById(character.currentMapId)?.type !== 'town' || character.pendingMapTransition !== null || character.travelIntent != null || character.status !== 'town') throw new BadRequestException('NPC interactions are only available in Town');

      const node = this.questNode(npc, nodeId);
      const choice = (node.choices ?? []).find((x: any) => x.id === choiceId);
      if (!choice || !(await this.choiceAvailable(choice, character))) throw new BadRequestException('Dialogue choice is not available');

      if (choice.effect?.type === 'eat_bread') {
        if (!this.characterHungry(character)) throw new BadRequestException('Character is not hungry');
        const consumedItemId = await this.consumeFoodForNpc(manager, character);
        return { ...(await this.dialogueState(character, npcId, choice.nextNodeId ?? 'hungry_done')), consumedItemId };
      }

      return this.dialogueState(character, npcId, choice.nextNodeId ?? node.id);
    });
  }

  async interactWithNPC(characterId: string, npcId: string, action: string) {
    await this.assertTown(characterId);
    const npc = this.npc(npcId);
    if (action !== 'open') throw new BadRequestException('Unsupported NPC action');
    return { npcId: npc.id, types: npc.types, name: npc.name };
  }

  private cookingThresholds(): number[] { return [0, 20, 44, 78, 128, 328, 828, 1578]; }

  private cookingLevelForXp(xpValue: number): number {
    const xp = Math.max(0, Number(xpValue) || 0);
    let level = 1;
    while (level < 99 && xp >= this.cookingThreshold(level + 1)) level++;
    return level;
  }

  private cookingThreshold(level: number): number {
    const known = this.cookingThresholds(); if (level <= 1) return 0; if (known[level - 1] !== undefined) return known[level - 1];
    let total = known[known.length - 1], increment = known[known.length - 1] - known[known.length - 2];
    for (let current = known.length; current < level; current++) { increment = Math.floor(increment * 1.5); total += increment; }
    return total;
  }

  private cookingProgress(character: Character) {
    const xp = Math.max(0, Number(character.cookingXp ?? 0));
    const level = this.cookingLevelForXp(xp);
    const current = this.cookingThreshold(level); const next = this.cookingThreshold(level + 1);
    return { level, xp, totalXp: xp, xpIntoLevel: xp - current, xpToNextLevel: next - current, nextLevelXp: next, progressPercent: Math.max(0, Math.min(100, (xp - current) / Math.max(1, next - current) * 100)) };
  }

  private async cookingState(manager: EntityManager, character: Character) {
    const recipes = this.dataService.getCookingRecipes()?.recipes ?? [];
    const rows = await manager.getRepository(InventoryItem).find({ where: { characterId: character.id, location: 'inventory' }, order: { slotIndex: 'ASC' } });
    const totals = new Map<string, number>(); for (const row of rows) totals.set(row.itemId, (totals.get(row.itemId) ?? 0) + Number(row.quantity));
    const progress = this.cookingProgress(character);
    const reservedIngredients: Record<string, number> = {};
    const session = character.cookingSession ?? null;
    if (session) for (const req of session.ingredients ?? []) reservedIngredients[req.itemId] = Number(reservedIngredients[req.itemId] ?? 0) + Number(req.quantity);
    const recipeStates = recipes.map((recipe: any) => {
      const ingredients = recipe.ingredients.map((req: any) => ({ ...req, owned: totals.get(req.itemId) ?? 0, available: Math.max(0, (totals.get(req.itemId) ?? 0) - (reservedIngredients[req.itemId] ?? 0)), item: this.item(req.itemId) }));
      const output = this.item(recipe.outputItemId);
      return { ...recipe, output, ingredients, unlocked: progress.level >= recipe.requiredLevel, hasIngredients: ingredients.every((req: any) => req.available >= req.quantity), canReserveOutput: this.canReserveCapacity(rows, output), available: character.currentMapId === TOWN_MAP_ID && character.status === 'town' && !character.travelIntent && !character.pendingMapTransition && progress.level >= recipe.requiredLevel && ingredients.every((req: any) => req.available >= req.quantity) && this.canReserveCapacity(rows, output) && !session };
    });
    return { characterId: character.id, progress, recipes: recipeStates, session };
  }

  private canReserveCapacity(rows: InventoryItem[], item: any): boolean {
    if (item?.stackable) {
      if (rows.some(row => row.itemId === item.id && row.quantity < Number(item.maxStack ?? 1))) return true;
    }
    return rows.length < INVENTORY_SLOTS;
  }

  private async scheduleCookingCompletion(characterId: string, session: any) {
    const delay = Math.max(0, Date.parse(session.completesAt) - Date.now());
    await this.bullQueue.add('complete-cooking', { characterId, sessionId: session.id, generation: session.generation }, { jobId: `cooking-${characterId}-${session.id}`, delay, removeOnComplete: true, attempts: 10, backoff: { type: 'exponential', delay: 1000 } });
  }

  async getCookingState(characterId: string) {
    await this.reconcileCooking(characterId);
    return this.characterRepo.manager.transaction(async manager => {
      const character = await manager.getRepository(Character).findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      return this.cookingState(manager, character);
    });
  }

  async startCooking(characterId: string, recipeId: string) {
    const recipes = this.dataService.getCookingRecipes()?.recipes ?? [];
    const recipe = recipes.find((row: any) => row.id === recipeId);
    if (!recipe) throw new BadRequestException('Unknown Cooking recipe');
    const result = await this.battleService.withCharacterQueueLock(characterId, () => this.characterRepo.manager.transaction(async manager => {
      const character = await this.characterForTown(manager, characterId);
      if (character.currentMapId !== TOWN_MAP_ID) throw new BadRequestException('Cooking is available only in Sierra Village');
      if (character.cookingSession) throw new BadRequestException('Cooking session already active');
      const state = await this.cookingState(manager, character);
      const candidate = state.recipes.find((row: any) => row.id === recipeId);
      if (!candidate?.unlocked) throw new BadRequestException('Cooking level too low for this recipe');
      if (!candidate.hasIngredients) throw new BadRequestException('Insufficient ingredients');
      if (!candidate.canReserveOutput) throw new BadRequestException('Not enough inventory space for the cooked food');
      const now = new Date(); const session = { id: randomUUID(), generation: randomUUID(), recipeId, startedAt: now.toISOString(), completesAt: new Date(now.getTime() + 10_000).toISOString(), ingredients: recipe.ingredients.map((req: any) => ({ itemId: req.itemId, quantity: Number(req.quantity) })), outputItemId: recipe.outputItemId, outputQuantity: 1, xpReward: Number(recipe.xpReward) };
      character.cookingSession = session; await manager.getRepository(Character).save(character);
      return { character, session };
    }));
    await this.scheduleCookingCompletion(characterId, result.session);
    return this.getCookingState(characterId);
  }

  async cancelCooking(characterId: string, sessionId?: string) {
    const now = Date.now();
    const result = await this.battleService.withCharacterQueueLock(characterId, () => this.characterRepo.manager.transaction(async manager => {
      const character = await manager.getRepository(Character).findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      const session = character.cookingSession;
      if (!session) throw new BadRequestException('No active Cooking session');
      if (sessionId && session.id !== sessionId) throw new BadRequestException('Cooking session has changed');
      if (now >= Date.parse(session.completesAt)) return { complete: true, characterId, sessionId: session.id };
      character.cookingSession = null; await manager.getRepository(Character).save(character);
      return { complete: false, characterId, sessionId: session.id };
    }));
    if (result.complete) await this.completeCooking(characterId, result.sessionId);
    else { const job = await this.bullQueue.getJob(`cooking-${characterId}-${result.sessionId}`); if (job) await job.remove().catch(() => undefined); }
    return this.getCookingState(characterId);
  }

  async reconcileCooking(characterId?: string) {
    const characters = characterId ? [await this.characterRepo.findOne({ where: { id: characterId } })].filter(Boolean) as Character[] : await this.characterRepo.find({ where: {} });
    for (const character of characters) {
      const session = character.cookingSession;
      if (!session?.id || !session.completesAt) continue;
      const jobId = `cooking-${character.id}-${session.id}`;
      const job = await this.bullQueue.getJob(jobId).catch(() => null);
      if (!job) await this.scheduleCookingCompletion(character.id, session);
      if (Date.now() >= Date.parse(session.completesAt)) await this.completeCooking(character.id, session.id);
    }
  }

  async completeCooking(characterId: string, sessionId: string) {
    const result = await this.battleService.withCharacterQueueLock(characterId, () => this.characterRepo.manager.transaction(async manager => {
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      const session = character.cookingSession;
      if (!session || session.id !== sessionId) return null;
      if (Date.now() < Date.parse(session.completesAt)) return null;
      const previousLevel = Math.max(1, Number(character.cookingLevel ?? 1));
      const recipe = (this.dataService.getCookingRecipes()?.recipes ?? []).find((row: any) => row.id === session.recipeId);
      if (!recipe || recipe.outputItemId !== session.outputItemId) throw new BadRequestException('Cooking recipe changed during session');
      const invRepo = manager.getRepository(InventoryItem);
      const rows = await invRepo.find({ where: { characterId, location: 'inventory' }, lock: { mode: 'pessimistic_write' } });
      const totals = new Map<string, number>(); for (const row of rows) totals.set(row.itemId, (totals.get(row.itemId) ?? 0) + Number(row.quantity));
      for (const req of session.ingredients ?? []) if ((totals.get(req.itemId) ?? 0) < Number(req.quantity)) throw new BadRequestException(`Reserved ingredient missing: ${req.itemId}`);
      for (const req of session.ingredients ?? []) await this.inventoryService.removeItem(characterId, req.itemId, Number(req.quantity), manager, true);
      await this.inventoryService.addItem(characterId, session.outputItemId, 1, 'inventory', undefined, manager, true);
      character.cookingXp = Number(character.cookingXp ?? 0) + Number(recipe.xpReward);
      character.cookingLevel = this.cookingLevelForXp(character.cookingXp);
      character.cookingSession = null; await characterRepo.save(character);
      return { character, levelUp: character.cookingLevel > previousLevel, previousLevel, newLevel: character.cookingLevel };
    }));
    if (result) {
      await this.battleService.runFutureCombatMutation(characterId, async () => undefined);
      // The completion transaction is authoritative; clients re-read Inventory/Character on the modal deadline.
    }
    return result;
  }

  async getWarehouse(characterId: string): Promise<InventoryItem[]> { await this.assertTown(characterId); return this.inventoryRepo.find({ where: { characterId, location: 'warehouse' }, order: { slotIndex: 'ASC' } }); }
  async getWarehouseCapacity(characterId: string) { await this.assertTown(characterId); const used = await this.inventoryRepo.count({ where: { characterId, location: 'warehouse' } }); return { used, max: 10 }; }
  async depositToWarehouse(characterId: string, itemId: string, quantity: number) { await this.assertTown(characterId); return this.inventoryService.transferToWarehouse(characterId, itemId, quantity); }
  async withdrawFromWarehouse(characterId: string, itemId: string, quantity: number) { await this.assertTown(characterId); return this.inventoryService.transferFromWarehouse(characterId, itemId, quantity); }
  async transferWarehouseRow(characterId: string, rowId: string, direction: 'deposit' | 'withdraw') {
    await this.assertTown(characterId);
    return this.inventoryService.transferInventoryRow(characterId, rowId, direction === 'deposit' ? 'inventory' : 'warehouse', direction === 'deposit' ? 'warehouse' : 'inventory');
  }
  async getTownNews() { return []; }
}
