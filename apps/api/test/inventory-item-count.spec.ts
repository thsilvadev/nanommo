import { BadRequestException } from '@nestjs/common';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { BattleService } from '../src/modules/battle/battle.service';

describe('Inventory quantity scope', () => {
  function serviceWithInventoryRows(rows: Array<Record<string, any>>) {
    const service = Object.create(InventoryService.prototype) as any;
    service.inventoryItemRepo = {
      find: jest.fn(async ({ where }: any) => rows.filter((row) =>
        row.characterId === where.characterId &&
        row.itemId === where.itemId &&
        row.location === where.location
      )),
      save: jest.fn(async (row: any) => row),
      remove: jest.fn(async () => undefined),
    };
    return service;
  }

  it('counts all inventory stacks but never counts warehouse stock', async () => {
    const service = serviceWithInventoryRows([
      { id: 'inv-1', characterId: 'char-1', itemId: 'food_bread', location: 'inventory', quantity: 2 },
      { id: 'inv-2', characterId: 'char-1', itemId: 'food_bread', location: 'inventory', quantity: 3 },
      { id: 'warehouse-1', characterId: 'char-1', itemId: 'food_bread', location: 'warehouse', quantity: 10 },
    ]);

    await expect(service.getItemCount('char-1', 'food_bread')).resolves.toBe(5);
    expect(service.inventoryItemRepo.find).toHaveBeenCalledWith({
      where: { characterId: 'char-1', itemId: 'food_bread', location: 'inventory' },
    });
  });

  it('reports zero inventory quantity when the item exists only in the warehouse', async () => {
    const service = serviceWithInventoryRows([
      { id: 'warehouse-1', characterId: 'char-1', itemId: 'food_bread', location: 'warehouse', quantity: 10 },
    ]);

    await expect(service.getItemCount('char-1', 'food_bread')).resolves.toBe(0);
  });

  it('removes items only from inventory, never from warehouse', async () => {
    const service = serviceWithInventoryRows([
      { id: 'inv-1', characterId: 'char-1', itemId: 'food_bread', location: 'inventory', slotIndex: 0, quantity: 2 },
    ]);

    await service.removeItem('char-1', 'food_bread', 1);

    expect(service.inventoryItemRepo.find).toHaveBeenCalledWith({
      where: { characterId: 'char-1', itemId: 'food_bread', location: 'inventory' },
      order: { slotIndex: 'ASC' },
    });
    expect(service.inventoryItemRepo.save).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 }));
  });

  it('skips Auto Feed when inventory quantity disappears instead of aborting battle resolution', async () => {
    const service = Object.create(BattleService.prototype) as any;
    service.dataService = {
      getItemById: jest.fn(() => ({
        id: 'food_bread',
        type: 'food',
        effect: { type: 'food_buff', durationSeconds: 3600, hpRegenPerTenTicks: 4, spRegenPerTenTicks: 1 },
      })),
    };
    service.inventoryService = {
      getItemCount: jest.fn(async () => 1),
      consumeFood: jest.fn(async () => { throw new BadRequestException('Insufficient item quantity'); }),
    };
    const character = {
      id: 'char-1',
      autoFeed: true,
      pendingMapTransition: null,
      diet: [{ itemId: 'food_bread', consumedAt: '2020-01-01T00:00:00.000Z', digestUntil: '2020-01-01T01:00:00.000Z', dietLevel: 0 }],
      dietLevels: { food_bread: { level: 0, lastDigestUntil: '2020-01-01T01:00:00.000Z' } },
    };

    await expect(service.tryAutoFeed(character, 0, {})).resolves.toBe(false);
    expect(service.inventoryService.consumeFood).toHaveBeenCalledTimes(1);
  });
});
