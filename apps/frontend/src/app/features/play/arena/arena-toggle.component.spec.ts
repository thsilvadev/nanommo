import { TestBed } from '@angular/core/testing';
import { ArenaToggleComponent } from './arena-toggle.component';

describe('ArenaToggleComponent', () => {
  function render(mode: 'map' | 'arena', available = true) {
    TestBed.configureTestingModule({ imports: [ArenaToggleComponent] });
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
});
