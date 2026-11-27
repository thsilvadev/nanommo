import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BattleStore, InventoryStore } from '../../core/game.store';
import { VendorStore } from '../../core/vendor.store';
import { CatalogService } from '../../core/catalog.service';
import { InventoryGrid } from './components';

describe('Refined equipment floating tooltip presentation', () => {
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  it('renders native and silver/mango rolled breakdowns and animates only the +12 title', async () => {
    TestBed.configureTestingModule({
      imports: [InventoryGrid],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: InventoryStore, useValue: { items: signal([
          { id: 'crafted', itemId: 'equip_body_phys_t2', quantity: 1, slotIndex: 0, instanceData: { refinementLevel: 12, rolledAttribute: 'VIT', rolledValue: 15, refinementBaseRolledValue: 3 } },
          { id: 'drop', itemId: 'equip_body_phys_t2', quantity: 1, slotIndex: 1, instanceData: { refinementLevel: 10, rolledStat: 'defense', rolledStatValue: 19, refinementBaseRolledStatValue: 3 } },
        ]), equipment: signal([]), draggedItemId: signal(null) } },
        { provide: BattleStore, useValue: { active: signal(null) } },
        { provide: VendorStore, useValue: { selectedNpcId: signal('') } },
      ],
    });
    TestBed.inject(CatalogService).items.set([{ id: 'equip_body_phys_t2', name: 'Armor', type: 'equipment', tier: 4, slot: 'body', fixedStats: { def: 4 } }] as any);
    const fixture = TestBed.createComponent(InventoryGrid);
    fixture.detectChanges();
    try {
      const items = fixture.nativeElement.querySelectorAll('.item');
      items[0].dispatchEvent(new PointerEvent('pointerenter', { clientX: 100, clientY: 100 }));
      await frame();
      const tooltip = document.querySelector<HTMLElement>('.nm-floating-tooltip')!;
      expect(tooltip.textContent).toContain('Defense: +4 (+36)');
      const attribute = tooltip.querySelector<HTMLElement>('.tooltip-rolled-attribute')!;
      expect(attribute?.textContent).toContain('+3 (+12)');
      if (attribute) expect(getComputedStyle(attribute).color).toBe('rgb(220, 227, 235)');
      const title = tooltip.querySelector<HTMLElement>('strong')!;
      expect(title.classList.contains('refinement-12')).toBeTrue();
      expect(getComputedStyle(title).color).toBe('rgb(234, 138, 255)');
      expect(getComputedStyle(title).animationName).toBe(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'equipment-title-vibration');
      expect(getComputedStyle(tooltip).animationName).toBe('none');
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      items[1].dispatchEvent(new PointerEvent('pointerenter', { clientX: 100, clientY: 100 }));
      await frame();
      const dropTooltip = Array.from(document.querySelectorAll<HTMLElement>('.nm-floating-tooltip')).find(el => el.style.display !== 'none')!;
      const stat = dropTooltip.querySelector<HTMLElement>('.tooltip-rolled-stat')!;
      expect(stat?.textContent).toContain('Defense: +3 (+16)');
      if (stat) expect(getComputedStyle(stat).color).toBe('rgb(255, 179, 71)');
      expect(getComputedStyle(dropTooltip.querySelector('strong')!).animationName).toBe('none');
    } finally { fixture.destroy(); }
  });
});
