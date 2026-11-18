import { TestBed } from '@angular/core/testing';
import { mapViewMode, TownViewToggleComponent } from './town-view-toggle.component';

describe('map-board view mode (mapViewMode)', () => {
  it('in a town the default is the town scene (house)', () => {
    expect(mapViewMode(true, 'map_town', null)).toBe('town');
  });
  it('the player choice sticks while staying in that town', () => {
    expect(mapViewMode(true, 'map_town', { mapId: 'map_town', mode: 'map' })).toBe('map');
  });
  it('arriving in another town resets to the town scene', () => {
    expect(mapViewMode(true, 'map_aramaia_city', { mapId: 'map_town', mode: 'map' })).toBe('town');
  });
  it('outside a town it is always the map', () => {
    expect(mapViewMode(false, 'map_green_grounds_0', { mapId: 'map_green_grounds_0', mode: 'town' })).toBe('map');
  });
});

describe('TownViewToggleComponent', () => {
  function render(mode: 'map' | 'town') {
    TestBed.configureTestingModule({ imports: [TownViewToggleComponent] });
    const fixture = TestBed.createComponent(TownViewToggleComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    return fixture;
  }
  const button = (fixture: any, label: string): HTMLButtonElement => fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);

  it('shows icon-only Map and Town buttons with the house pressed', () => {
    const fixture = render('town');
    expect(button(fixture, 'Map').getAttribute('aria-pressed')).toBe('false');
    expect(button(fixture, 'Town').getAttribute('aria-pressed')).toBe('true');
    expect(button(fixture, 'Map').querySelector('svg')).not.toBeNull();
    expect(button(fixture, 'Town').textContent!.trim()).toBe('');
  });

  it('emits the chosen mode and never lets the click reach the map below', () => {
    const fixture = render('town');
    const chosen: string[] = [];
    fixture.componentInstance.modeChange.subscribe(m => chosen.push(m));
    let reachedParent = 0;
    fixture.nativeElement.parentElement?.addEventListener('click', () => reachedParent++);
    fixture.nativeElement.parentElement?.addEventListener('pointerdown', () => reachedParent++);
    button(fixture, 'Map').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    button(fixture, 'Map').click();
    expect(chosen).toEqual(['map']);
    expect(reachedParent).toBe(0);
  });
});
