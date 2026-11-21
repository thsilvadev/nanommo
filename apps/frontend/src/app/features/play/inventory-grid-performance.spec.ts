import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BattleStore, InventoryStore } from '../../core/game.store';
import { VendorStore } from '../../core/vendor.store';
import { CatalogService } from '../../core/catalog.service';
import { InventoryGrid } from './components';

/**
 * The inventory is on screen while the town and battles animate, so it is
 * re-checked many times a second. A pass with nothing changed must not touch
 * the DOM: tooltips used to be rebuilt for every item on every pass.
 */
describe('InventoryGrid change detection cost', () => {
  it('a pass with nothing changed adds or removes no DOM nodes', async () => {
    const all = await fetch('/data/items.json').then(r => r.json());
    const defs: any[] = Object.values(all).flat() as any[];
    const equipment = defs.filter(d => d.type === 'equipment').slice(0, 25);
    const others = defs.filter(d => d.type !== 'equipment').slice(0, 15);
    const items = [...equipment, ...others].map((d, i) => ({ id: `inv${i}`, itemId: d.id, quantity: 1 + (i % 4), slotIndex: i, instanceData: null }));
    TestBed.configureTestingModule({
      imports: [InventoryGrid],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: InventoryStore, useValue: { items: signal(items), equipment: signal([]), draggedItemId: signal(null) } },
        { provide: BattleStore, useValue: { active: signal(null) } },
        { provide: VendorStore, useValue: { selectedNpcId: signal('') } },
      ],
    });
    const catalog = TestBed.inject(CatalogService);
    catalog.items.set(defs);
    catalog.equippedEquipment.set(equipment.slice(0, 6).map((d, i) => ({ slot: d.slot === 'accessory' ? 'accessoryLeft' : d.slot, itemId: d.id, id: 'eq' + i })));
    const fixture = TestBed.createComponent(InventoryGrid);
    fixture.detectChanges();
    const lines = fixture.nativeElement.querySelectorAll('.item-tooltip span').length;
    expect(lines).toBeGreaterThan(40);
    let mutations = 0;
    const observer = new MutationObserver(list => { for (const m of list) mutations += m.addedNodes.length + m.removedNodes.length; });
    observer.observe(fixture.nativeElement, { childList: true, subtree: true });
    for (let i = 0; i < 20; i++) fixture.detectChanges();
    await new Promise(r => setTimeout(r));
    observer.disconnect();
    expect(mutations).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.item-tooltip span').length).toBe(lines);
  });
});
