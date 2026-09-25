"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var InventoryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const inventory_item_entity_1 = require("../../database/entities/inventory-item.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const data_service_1 = require("../data/data.service");
let InventoryService = InventoryService_1 = class InventoryService {
    inventoryItemRepo;
    characterRepo;
    dataService;
    logger = new common_1.Logger(InventoryService_1.name);
    constructor(inventoryItemRepo, characterRepo, dataService) {
        this.inventoryItemRepo = inventoryItemRepo;
        this.characterRepo = characterRepo;
        this.dataService = dataService;
    }
    /**
     * Get all inventory items for a character
     */
    async getInventory(characterId) {
        return this.inventoryItemRepo.find({
            where: { characterId, location: 'inventory' },
            order: { slotIndex: 'ASC' },
        });
    }
    /**
     * Get all warehouse items for a character
     */
    async getWarehouse(characterId) {
        return this.inventoryItemRepo.find({
            where: { characterId, location: 'warehouse' },
            order: { slotIndex: 'ASC' },
        });
    }
    /**
     * Get inventory item count for a specific item
     */
    async getItemCount(characterId, itemId) {
        const item = await this.inventoryItemRepo.findOne({
            where: { characterId, itemId },
        });
        return item?.quantity ?? 0;
    }
    /**
     * Check if location has free slots
     */
    async getFreeSlots(characterId, location) {
        const maxSlots = location === 'inventory' ? 50 : 10;
        const usedSlots = await this.inventoryItemRepo.count({
            where: { characterId, location },
        });
        return maxSlots - usedSlots;
    }
    /**
     * Get next available slot index
     */
    async getNextSlot(characterId, location) {
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
        throw new common_1.BadRequestException('No available slots');
    }
    /**
     * Add item(s) to inventory or warehouse with automatic stacking
     * Falls back to warehouse if inventory is full
     */
    async addItem(characterId, itemId, quantity, location = 'inventory', instanceData) {
        const item = this.dataService.getItemById(itemId);
        if (!item)
            throw new common_1.NotFoundException(`Item ${itemId} not found`);
        let remaining = quantity;
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
                    await this.inventoryItemRepo.save(stack);
                    remaining -= toAdd;
                    if (remaining === 0) {
                        return stack;
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
                    this.logger.debug(`Inventory full for character ${characterId}, falling back to warehouse`);
                    return this.addItem(characterId, itemId, remaining, 'warehouse', instanceData);
                }
                throw new common_1.BadRequestException('Inventory and warehouse full');
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
                const saved = await this.inventoryItemRepo.save(newItem);
                remaining -= stackSize;
                if (remaining === 0) {
                    return saved;
                }
            }
        }
        throw new Error('Unexpected state in addItem');
    }
    /**
     * Remove item(s) from inventory
     */
    async removeItem(characterId, itemId, quantity) {
        let remaining = quantity;
        // Find and remove from stacks
        const items = await this.inventoryItemRepo.find({
            where: { characterId, itemId },
        });
        for (const item of items) {
            if (remaining === 0)
                break;
            const toRemove = Math.min(remaining, item.quantity);
            item.quantity -= toRemove;
            remaining -= toRemove;
            if (item.quantity <= 0) {
                await this.inventoryItemRepo.remove(item);
            }
            else {
                await this.inventoryItemRepo.save(item);
            }
        }
        if (remaining > 0) {
            throw new common_1.BadRequestException('Insufficient item quantity');
        }
    }
    /**
     * Move item between inventory and warehouse
     */
    async transferItem(characterId, itemId, quantity, fromLocation, toLocation) {
        if (fromLocation === toLocation) {
            throw new common_1.BadRequestException('Source and destination must be different');
        }
        // Get item from source location
        const sourceItem = await this.inventoryItemRepo.findOne({
            where: { characterId, itemId, location: fromLocation },
        });
        if (!sourceItem || sourceItem.quantity < quantity) {
            throw new common_1.BadRequestException('Insufficient quantity in source location');
        }
        // Remove from source
        sourceItem.quantity -= quantity;
        if (sourceItem.quantity === 0) {
            await this.inventoryItemRepo.remove(sourceItem);
        }
        else {
            await this.inventoryItemRepo.save(sourceItem);
        }
        // Add to destination
        return this.addItem(characterId, itemId, quantity, toLocation, sourceItem.instanceData);
    }
    /**
     * Transfer item to warehouse (convenience method)
     */
    async transferToWarehouse(characterId, itemId, quantity) {
        return this.transferItem(characterId, itemId, quantity, 'inventory', 'warehouse');
    }
    /**
     * Transfer item from warehouse (convenience method)
     */
    async transferFromWarehouse(characterId, itemId, quantity) {
        return this.transferItem(characterId, itemId, quantity, 'warehouse', 'inventory');
    }
    /**
     * Sell item to vendor (removes from inventory, adds gold to character)
     */
    async sellToVendor(characterId, itemId, quantity) {
        const item = this.dataService.getItemById(itemId);
        if (!item)
            throw new common_1.NotFoundException(`Item ${itemId} not found`);
        const goldPerUnit = item.sellPriceToVendor || 0;
        const totalGold = goldPerUnit * quantity;
        // Remove from inventory
        await this.removeItem(characterId, itemId, quantity);
        // Add gold to character
        const character = await this.characterRepo.findOne({
            where: { id: characterId },
        });
        if (!character)
            throw new common_1.NotFoundException('Character not found');
        character.gold = Math.min(Number(character.gold) + totalGold, 1_000_000_000_000);
        await this.characterRepo.save(character);
        this.logger.debug(`Sold ${quantity}x ${itemId} for ${totalGold} gold to character ${characterId}`);
        return totalGold;
    }
    /**
     * Process battle drops into inventory
     */
    async processBattleDrops(characterId, drops) {
        const results = [];
        for (const drop of drops) {
            try {
                const result = await this.addItem(characterId, drop.itemId, drop.quantity);
                results.push(result);
                this.logger.debug(`Added ${drop.quantity}x ${drop.itemId} to character ${characterId} inventory`);
            }
            catch (error) {
                this.logger.warn(`Failed to add drop ${drop.itemId} to character ${characterId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                // Continue processing other drops even if one fails
            }
        }
        return results;
    }
};
exports.InventoryService = InventoryService;
exports.InventoryService = InventoryService = InventoryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(inventory_item_entity_1.InventoryItem)),
    __param(1, (0, typeorm_1.InjectRepository)(character_entity_1.Character)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        data_service_1.DataService])
], InventoryService);
//# sourceMappingURL=inventory.service.js.map