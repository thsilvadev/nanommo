import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MapBoard } from '../components';
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
  const buttons = (fixture: any): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('button'));

  it('in the town it is one illustrated button that goes to the map', () => {
    const fixture = render('town');
    const all = buttons(fixture);
    expect(all.length).toBe(1);
    expect(all[0].classList).toContain('town-view-button');
    expect(all[0].getAttribute('aria-label')).toBe('Map');
    expect(all[0].hasAttribute('aria-pressed')).toBeFalse();
    const img = all[0].querySelector('img[src$="town-view-map.svg"]');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('alt')).toBe('');
    const chosen: string[] = [];
    fixture.componentInstance.modeChange.subscribe(m => chosen.push(m));
    all[0].click();
    expect(chosen).toEqual(['map']);
  });

  it('on the map it shows the house and goes to the town', () => {
    const fixture = render('map');
    const all = buttons(fixture);
    expect(all.length).toBe(1);
    expect(all[0].getAttribute('aria-label')).toBe('Town');
    expect(all[0].querySelector('img[src$="town-view-house.svg"]')).not.toBeNull();
    const chosen: string[] = [];
    fixture.componentInstance.modeChange.subscribe(m => chosen.push(m));
    all[0].click();
    expect(chosen).toEqual(['town']);
  });

  it('never lets the click reach the map below', () => {
    const fixture = render('town');
    let reachedParent = 0;
    fixture.nativeElement.parentElement?.addEventListener('click', () => reachedParent++);
    fixture.nativeElement.parentElement?.addEventListener('pointerdown', () => reachedParent++);
    const button = buttons(fixture)[0];
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    button.click();
    expect(reachedParent).toBe(0);
  });
});

describe('MapBoard view choice', () => {
  function board() {
    const b: any = Object.create(MapBoard.prototype);
    b.viewChoice = signal<{ mapId: string; mode: 'map' | 'town' } | null>({ mapId: 'map_town', mode: 'map' });
    return b;
  }

  it('choice of another visit is ignored: leaving the map forgets it', () => {
    const b = board();
    b.forgetViewChoiceOnMapChange('map_town', 'map_green_grounds_0');
    expect(b.viewChoice()).toBeNull();
  });

  it('keeps the choice while the map does not change', () => {
    const b = board();
    b.forgetViewChoiceOnMapChange('map_town', 'map_town');
    expect(b.viewChoice()).toEqual({ mapId: 'map_town', mode: 'map' });
  });
});
