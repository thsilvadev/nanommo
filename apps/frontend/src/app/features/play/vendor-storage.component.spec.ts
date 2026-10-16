import { signal } from '@angular/core';
import { InventoryGrid, VendorPanel } from './components';
import { sellModalMaxQuantity } from '../../core/vendor.store';

describe('Town Storage drag/drop and double-click handlers', () => {
  const makeNpc = (type: 'storage' | 'vendor') => ({
    id: type === 'storage' ? 'storage' : 'william',
    name: type === 'storage' ? 'Storage' : 'William',
    location: 'town' as const,
    types: [type],
    ...(type === 'storage' ? { monologue: "You know I have a name, right? But you'll keep calling me Storage anyway." } : {}),
  });
  const setup = (type: 'storage' | 'vendor' = 'storage') => {
    const selectedNpc = signal<any>(makeNpc(type));
    const vendor: any = {
      selectedNpc: () => selectedNpc(), selectedNpcId: () => selectedNpc()?.id ?? '',
      selectedNpcSignal: selectedNpc,
      transferWarehouseRow: jasmine.createSpy('transferWarehouseRow').and.resolveTo(undefined),
      openSell: jasmine.createSpy('openSell').and.resolveTo(undefined),
      openBuy: jasmine.createSpy('openBuy'),
      load: jasmine.createSpy('load'),
      modal: signal<any>(null),
      setQuantity(value: number) { const m = this.modal(); if (m) this.modal.set({ ...m, quantity: Math.max(1, Math.min(m.maxQuantity, Math.trunc(value) || 1)) }); },
      all() { const m = this.modal(); if (m) this.setQuantity(m.maxQuantity); },
    };
    const inventory: any = {
      draggedItemId: signal<string | null>(null),
      beginDrag: jasmine.createSpy('beginDrag'), endDrag: jasmine.createSpy('endDrag'),
      useConsumable: jasmine.createSpy('useConsumable').and.resolveTo(undefined),
      equip: jasmine.createSpy('equip').and.resolveTo(undefined),
      unequip: jasmine.createSpy('unequip').and.resolveTo(undefined),
      moveItemToSlot: jasmine.createSpy('moveItemToSlot').and.resolveTo(undefined),
      sortInventory: jasmine.createSpy('sortInventory').and.resolveTo(undefined),
      items: () => [], equipment: () => [],
    };
    const catalog: any = {
      item: (id: string) => id === 'potion' ? { id, type: 'consumable' } : { id, type: 'equipment', slot: 'head' },
      itemIcon: (id: string) => `/assets/ui/items/${id}.svg`,
      itemTooltipLines: () => [],
    };
    const panel: any = Object.create(VendorPanel.prototype);
    Object.assign(panel, { vendor, inventory, catalog, slots: Array.from({ length: 10 }, (_, i) => i), storageDropListIds: ['storage-drop-list'] });
    const grid: any = Object.create(InventoryGrid.prototype);
    Object.assign(grid, {
      inventory, vendor, catalog, now: signal(Date.now()),
      highlightedSlot: signal<number | null>(null), sortError: signal<string | null>(null), sorting: signal(false),
    });
    return { selectedNpc, vendor, inventory, catalog, panel, grid };
  };

  it('deposits the specific dragged inventory row onto Storage', () => {
    const { panel, vendor, inventory } = setup('storage');
    panel.drop({ item: { data: { source: 'inventory', id: 'inventory-row-2', itemId: 'potion', quantity: 20 } } });
    expect(vendor.transferWarehouseRow).toHaveBeenCalledOnceWith('inventory-row-2', 'deposit');
    expect(vendor.openSell).not.toHaveBeenCalled();
    expect(inventory.endDrag).toHaveBeenCalled();
  });

  it('withdraws the specific warehouse row into Inventory by drag/drop and double-click', async () => {
    const { grid, panel, vendor, inventory } = setup('storage');
    await grid.dropInventory({ item: { data: { source: 'warehouse', id: 'warehouse-row-4', itemId: 'potion', quantity: 9 } }, dropPoint: { x: 0, y: 0 } } as any);
    expect(vendor.transferWarehouseRow).toHaveBeenCalledOnceWith('warehouse-row-4', 'withdraw');
    expect(inventory.endDrag).toHaveBeenCalled();
    vendor.transferWarehouseRow.calls.reset();
    await panel.doubleClickWarehouse({ id: 'warehouse-row-5', itemId: 'sword', quantity: 1 });
    expect(vendor.transferWarehouseRow).toHaveBeenCalledOnceWith('warehouse-row-5', 'withdraw');
  });

  it('double-clicking an inventory row deposits by row ID only while Storage is selected', async () => {
    const { grid, vendor, inventory, selectedNpc } = setup('storage');
    await grid.doubleClick({ id: 'inventory-row-1', itemId: 'potion', quantity: 20 });
    expect(vendor.transferWarehouseRow).toHaveBeenCalledOnceWith('inventory-row-1', 'deposit');
    expect(inventory.useConsumable).not.toHaveBeenCalled();
    selectedNpc.set(makeNpc('vendor'));
    await grid.doubleClick({ id: 'inventory-row-1', itemId: 'potion', quantity: 20 });
    expect(inventory.useConsumable).toHaveBeenCalledOnceWith('potion');
    expect(vendor.transferWarehouseRow).toHaveBeenCalledTimes(1);
  });

  it('keeps Vendor sell quantity scoped to the dragged stack and does not withdraw from Warehouse when Vendor is selected', async () => {
    const { grid, panel, vendor } = setup('vendor');
    panel.drop({ item: { data: { source: 'inventory', id: 'stack-row', itemId: 'potion', quantity: 20 } } });
    expect(vendor.openSell).toHaveBeenCalledOnceWith('potion', 20);
    await grid.dropInventory({ item: { data: { source: 'warehouse', id: 'warehouse-row', itemId: 'potion', quantity: 20 } }, dropPoint: { x: 0, y: 0 } } as any);
    expect(vendor.transferWarehouseRow).not.toHaveBeenCalled();
  });

  it('All remains bound to each modal maximum for both buy and stack-scoped sell', () => {
    const { vendor } = setup('vendor');
    vendor.modal.set({ mode: 'buy', itemId: 'potion', quantity: 1, maxQuantity: 7, unitPrice: 10 });
    vendor.all();
    expect(vendor.modal().quantity).toBe(7);
    expect(sellModalMaxQuantity(80, 20, true)).toBe(20);
    vendor.modal.set({ mode: 'sell', itemId: 'potion', quantity: 1, maxQuantity: sellModalMaxQuantity(80, 20, true), unitPrice: 2 });
    vendor.all();
    expect(vendor.modal().quantity).toBe(20);
  });
});
