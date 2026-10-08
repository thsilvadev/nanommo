import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { DataService } from '../data/data.service';
import { InventoryService } from '../inventory/inventory.service';
import { CharacterService } from '../character/character.service';
import { TOWN_MAP_ID } from '@nanommo/shared';

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
    if (character.currentMapId !== TOWN_MAP_ID || character.pendingMapTransition !== null || character.status !== 'town') throw new BadRequestException('Vendor transactions are only available in Town');
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

  private async removeInventoryAtomic(manager: EntityManager, characterId: string, itemId: string, quantity: number) {
    const repo = manager.getRepository(InventoryItem);
    const rows = await repo.find({ where: { characterId, location: 'inventory', itemId }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
    const owned = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (owned < quantity) throw new BadRequestException('Insufficient item quantity');
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

  async sellToVendor(characterId: string, vendorId: string, itemId: string, quantity: number) {
    this.assertPositiveInteger(quantity);
    const v = this.vendor(vendorId);
    const item = this.item(itemId);
    if (!item.stackable && quantity !== 1) throw new BadRequestException('Non-stackable items can only be sold one at a time');
    const unitPrice = this.sellPrice(v, itemId);
    const total = unitPrice * quantity;
    if (!Number.isSafeInteger(total)) throw new BadRequestException('Transaction total is invalid');

    return this.characterRepo.manager.transaction(async manager => {
      const character = await this.characterForTown(manager, characterId);
      await this.removeInventoryAtomic(manager, characterId, itemId, quantity);
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
    if (character.currentMapId !== TOWN_MAP_ID || character.pendingMapTransition !== null || character.status !== 'town') throw new BadRequestException('NPC interactions are only available in Town');
    return character;
  }

  private npcPublic(npc: any) {
    const types = Array.isArray(npc.types) ? npc.types : [];
    return { id: npc.id, name: npc.name, location: npc.location, types, greeting: npc.greeting ?? npc.vendor?.greeting };
  }

  async getTownNPCs(characterId: string) {
    await this.assertTown(characterId);
    const william = this.vendor();
    return [
      { id: william.id, name: william.name, location: william.location, types: ['vendor'], greeting: this.dataService.getNpcVendor()?.greeting },
      ...this.npcCatalog().map((npc: any) => this.npcPublic(npc)),
    ].filter((npc, index, all) => all.findIndex(x => x.id === npc.id) === index);
  }

  private questNode(npc: any, nodeId?: string) {
    const quest = npc.quest;
    if (!quest?.nodes) throw new BadRequestException('NPC does not provide quest dialogue');
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
    if (!Array.isArray(npc.types) || !npc.types.includes('quest')) throw new BadRequestException('NPC does not provide quest dialogue');
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
    if (!Array.isArray(npc.types) || !npc.types.includes('quest')) throw new BadRequestException('NPC does not provide quest dialogue');

    return this.characterRepo.manager.transaction(async manager => {
      const character = await manager.getRepository(Character).findOne({
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new NotFoundException('Character not found');
      if (character.currentMapId !== TOWN_MAP_ID || character.pendingMapTransition !== null || character.status !== 'town') throw new BadRequestException('NPC interactions are only available in Town');

      const node = this.questNode(npc, nodeId);
      const choice = (node.choices ?? []).find((x: any) => x.id === choiceId);
      if (!choice || !(await this.choiceAvailable(choice, character))) throw new BadRequestException('Dialogue choice is not available');

      if (choice.effect?.type === 'eat_bread') {
        if (!this.characterHungry(character)) throw new BadRequestException('Character is not hungry');
        const consumedItemId = await this.consumeFoodForNpc(manager, character);
        return { ...(await this.dialogueState(character, npcId, choice.nextNodeId ?? 'hungry_done')), consumedItemId };
      }

      if (choice.effect?.type === 'trade_items') {
        const effect = choice.effect;
        const requirements = Array.isArray(effect.remove) ? effect.remove : [];
        const rows = await manager.getRepository(InventoryItem).find({ where: { characterId, location: 'inventory' }, lock: { mode: 'pessimistic_write' } });
        for (const req of requirements) {
          const owned = rows.filter(r => r.itemId === req.itemId).reduce((n, r) => n + Number(r.quantity ?? 0), 0);
          if (owned < Number(req.quantity ?? 0)) throw new BadRequestException('Required quest items are missing');
        }
        for (const req of requirements) await this.removeInventoryAtomic(manager, characterId, req.itemId, Number(req.quantity));
        for (const reward of (effect.add ?? [])) await this.addInventoryAtomic(manager, characterId, reward.itemId, Number(reward.quantity ?? 1));
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

  async getWarehouse(characterId: string): Promise<InventoryItem[]> { return this.inventoryRepo.find({ where: { characterId, location: 'warehouse' }, order: { slotIndex: 'ASC' } }); }
  async getWarehouseCapacity(characterId: string) { const used = await this.inventoryRepo.count({ where: { characterId, location: 'warehouse' } }); return { used, max: 10 }; }
  async depositToWarehouse(_characterId: string, _itemId: string, _quantity: number) { throw new BadRequestException('Warehouse transfer is not implemented in this change'); }
  async withdrawFromWarehouse(_characterId: string, _itemId: string, _quantity: number) { throw new BadRequestException('Warehouse transfer is not implemented in this change'); }
  async getTownNews() { return []; }
}
