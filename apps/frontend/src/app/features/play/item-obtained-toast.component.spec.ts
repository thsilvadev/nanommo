import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GameSocketService } from '../../core/game.socket.service';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { ItemObtainedToastComponent } from './item-obtained-toast.component';

describe('ItemObtainedToastComponent', () => {
  let obtained: Subject<any>;
  let locale: LocaleService;
  const items: Record<string, { name: string; rarity: string }> = { a: { name: 'Mega Elixir', rarity: 'rare' }, b: { name: 'Slime Gel', rarity: 'common' }, c: { name: 'Divine Shard', rarity: 'epic' } };

  beforeEach(() => {
    jasmine.clock().install();
    obtained = new Subject();
    TestBed.configureTestingModule({
      imports: [ItemObtainedToastComponent],
      providers: [
        { provide: GameSocketService, useValue: { on: (event: string) => (event === 'inventory:obtained' ? obtained : new Subject()) } },
        { provide: CatalogService, useValue: { item: (id: string) => items[id], itemName: (id: string) => items[id]?.name ?? id, itemIcon: (id: string) => `/icons/${id}.svg` } },
      ],
    });
    locale = TestBed.inject(LocaleService);
  });
  afterEach(() => { jasmine.clock().uninstall(); locale.setLocale('en-US'); });

  function create() {
    const fixture = TestBed.createComponent(ItemObtainedToastComponent);
    fixture.detectChanges();
    return fixture;
  }
  const box = (fixture: any): HTMLElement | null => fixture.nativeElement.querySelector('.item-obtained');

  it('shows only the first item of a multi-item gain, in Portuguese', () => {
    locale.setLocale('pt-BR');
    const fixture = create();
    obtained.next({ items: [{ itemId: 'a', quantity: 3 }, { itemId: 'b', quantity: 1 }], source: 'battle' });
    fixture.detectChanges();
    expect(box(fixture)!.querySelector('.text')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Mega Elixir – 3 obtido(s).');
    expect(box(fixture)!.querySelector('img')!.getAttribute('src')).toBe('/icons/a.svg');
    expect(fixture.nativeElement.querySelectorAll('.item-obtained').length).toBe(1);
  });

  it('English text, and gone after 4 s', () => {
    const fixture = create();
    obtained.next({ items: [{ itemId: 'a', quantity: 20 }], source: 'event' });
    fixture.detectChanges();
    expect(box(fixture)!.querySelector('.text')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Mega Elixir – 20 obtained.');
    jasmine.clock().tick(3999);
    fixture.detectChanges();
    expect(box(fixture)).not.toBeNull();
    jasmine.clock().tick(1);
    fixture.detectChanges();
    expect(box(fixture)).toBeNull();
  });

  it('a newer gain replaces the box in place and restarts the 4 s', () => {
    const fixture = create();
    obtained.next({ items: [{ itemId: 'a', quantity: 1 }], source: 'battle' });
    fixture.detectChanges();
    const first = box(fixture);
    jasmine.clock().tick(2000);
    obtained.next({ items: [{ itemId: 'c', quantity: 1 }], source: 'event' });
    fixture.detectChanges();
    expect(box(fixture)).toBe(first);
    expect(first!.textContent).toContain('Divine Shard');
    jasmine.clock().tick(3999);
    fixture.detectChanges();
    expect(box(fixture)).not.toBeNull();
    jasmine.clock().tick(1);
    fixture.detectChanges();
    expect(box(fixture)).toBeNull();
  });

  it('no transition or animation, and an empty gain shows nothing', () => {
    const fixture = create();
    obtained.next({ items: [], source: 'mail' });
    fixture.detectChanges();
    expect(box(fixture)).toBeNull();
    obtained.next({ items: [{ itemId: 'c', quantity: 1 }], source: 'mail' });
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const style = getComputedStyle(box(fixture)!);
    expect(style.transitionDuration).toBe('0s');
    expect(style.animationName).toBe('none');
    expect(getComputedStyle(box(fixture)!.querySelector('.name')!).color).toBe('rgb(123, 47, 191)');
    fixture.nativeElement.remove();
  });
});
