import { TestBed } from '@angular/core/testing';
import { LocaleService } from '../../../core/locale.service';
import { ArenaToggleComponent } from './arena-toggle.component';
import { signal } from '@angular/core';
import { CharacterFaceService } from './character-face.service';

describe('ArenaToggleComponent', () => {
  function render(mode: 'map' | 'arena', available = true, face: string | null = null) {
    TestBed.configureTestingModule({ imports: [ArenaToggleComponent], providers: [{ provide: CharacterFaceService, useValue: { url: signal(face) } }] });
    const fixture = TestBed.createComponent(ArenaToggleComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('available', available);
    fixture.detectChanges();
    return fixture;
  }
  const button = (f: any): HTMLButtonElement | null => f.nativeElement.querySelector('button');

  it('on the map it shows the head and goes to the arena', () => {
    const f = render('map');
    expect(button(f)!.querySelector('img')!.getAttribute('src')).toContain('arena-view-head');
    let emitted: string | null = null;
    f.componentInstance.modeChange.subscribe((m: string) => (emitted = m));
    button(f)!.click();
    expect(emitted as string | null).toBe('arena');
  });

  it('in the arena it shows the map and goes back to it', () => {
    const f = render('arena');
    expect(button(f)!.querySelector('img')!.getAttribute('src')).toContain('town-view-map');
    let emitted: string | null = null;
    f.componentInstance.modeChange.subscribe((m: string) => (emitted = m));
    button(f)!.click();
    expect(emitted as string | null).toBe('map');
  });

  it('no webgl hides arena toggle', () => {
    expect(button(render('map', false))).toBeNull();
  });

  it('on the map the tooltip names the character view (Character / Personagem), not "Arena"', () => {
    const f = render('map');
    const locale = TestBed.inject(LocaleService);
    locale.locale.set('en-US');
    f.detectChanges();
    expect(button(f)!.getAttribute('title')).toBe('Character');
    expect(button(f)!.getAttribute('aria-label')).toBe('Character');
    locale.locale.set('pt-BR');
    f.detectChanges();
    expect(button(f)!.getAttribute('title')).toBe('Personagem');
  });

  it('shows the player face when it is known', () => {
    expect(button(render('map', true, 'data:image/png;base64,AAA'))!.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAA');
  });

  it('without a face it keeps the head icon', () => {
    expect(button(render('map', true, null))!.querySelector('img')!.getAttribute('src')).toContain('arena-view-head');
  });

  it('provides an 80px control and doubles its icon without passing clicks into the map', () => {
    const f = render('map');
    expect(button(f)!.getBoundingClientRect().width).toBe(80);
    expect(button(f)!.getBoundingClientRect().height).toBe(80);
    expect(getComputedStyle(button(f)!.querySelector('img')!).width).toBe('60px');
    const mapClick = jasmine.createSpy('mapClick');
    f.nativeElement.addEventListener('click', mapClick);
    button(f)!.click();
    expect(mapClick).not.toHaveBeenCalled();
    expect(getComputedStyle(button(f)!).backgroundImage).toContain('rgb(83, 65, 95)');
  });
});
