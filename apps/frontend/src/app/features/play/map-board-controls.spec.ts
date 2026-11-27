import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NEVER, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { GmTeleportStore } from '../../core/gm-teleport.store';
import { BattleStore, CharacterStore } from '../../core/game.store';
import { PartyStore } from '../../core/party.store';
import { TownStore } from '../../core/town.store';
import { VendorStore } from '../../core/vendor.store';
import { GameSocketService } from '../../core/game.socket.service';
import { CharacterFaceService } from './arena/character-face.service';
import { MapBoard } from './components';

describe('MapBoard controls and GM destination access', () => {
  it('anchors the 80px toggle clear of the header and permits hidden destinations only in GM mode', () => {
    const enabled = signal(false);
    const maps = [
      { id: 'field', name: 'Field', type: 'grind', coordinates: { x: 0, y: 0 } },
      { id: 'far', name: 'Far field', type: 'grind', coordinates: { x: 6, y: 5 } },
    ];
    const post = jasmine.createSpy('post').and.returnValue(NEVER);
    TestBed.configureTestingModule({ imports: [MapBoard], providers: [
      { provide: ApiService, useValue: { get: (path: string) => of(path === '/maps' ? maps : []), post } },
      { provide: CharacterStore, useValue: { character: signal({ id: 'gm', currentMapId: 'field', status: 'town', level: 1, discoveredMapIds: ['field'] }) } },
      { provide: BattleStore, useValue: { lastResolved: signal(null), active: signal(null), queue: signal([]), mapPresence: signal(null) } },
      { provide: PartyStore, useValue: { party: signal({ kind: 'manual', leaderCharacterId: 'other' }), battle: signal(null) } },
      { provide: TownStore, useValue: { isTown: () => false, selectedCharacter: signal(null) } },
      { provide: VendorStore, useValue: { selectedNpcId: signal(''), availableQuestNotifications: signal([]) } },
      { provide: GmTeleportStore, useValue: { enabled, forCharacter: () => {} } },
      { provide: GameSocketService, useValue: {} },
      { provide: CharacterFaceService, useValue: { url: signal(null) } },
    ] });
    const fixture = TestBed.createComponent(MapBoard);
    fixture.nativeElement.style.cssText = 'display:block;width:700px;height:500px';
    fixture.detectChanges();
    try {
      const viewport = fixture.nativeElement.querySelector('.viewport') as HTMLElement;
      const toggle = viewport.querySelector('app-arena-toggle') as HTMLElement;
      expect(toggle).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.map-head app-arena-toggle')).toBeNull();
      if (toggle) {
        const rect = toggle.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
        expect(Math.abs(bounds.right - rect.right - 19)).toBeLessThan(1);
        expect(Math.abs(bounds.bottom - rect.bottom - 19)).toBeLessThan(1);
        expect(toggle.querySelector('button')!.getBoundingClientRect().width).toBe(80);
      }
      const far = viewport.querySelector('[data-map-id="far"]') as HTMLButtonElement;
      expect(far.disabled).toBeTrue();
      enabled.set(true); fixture.detectChanges();
      expect(far.disabled).toBeFalse();
      expect(viewport.querySelector('.fog-cell')).toBeNull();
      far.click();
      expect(post).toHaveBeenCalledWith('/maps/far/gm-teleport', jasmine.any(Object));
      enabled.set(false); fixture.detectChanges();
      expect(far.disabled).toBeTrue();
      expect(viewport.querySelector('.fog-cell')).not.toBeNull();
    } finally { fixture.destroy(); }
  });
});
