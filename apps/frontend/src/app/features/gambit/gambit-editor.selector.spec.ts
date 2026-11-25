import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GambitEditorComponent } from './gambit-editor.component';
import { ApiService } from '../../core/api.service';
import { CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { CombatActionsStore } from '../../core/combat-actions.store';
import { PartyStore } from '../../core/party.store';
import { BrowserNotificationsService } from '../../core/browser-notifications.service';

describe('Gambit action selector', () => {
  it('keeps the selected action visible after change detection and subsequent edits', async () => {
    const line: any = { priority: 1, enabled: true, conditions: [{ id: 'self_hp', params: {} }], action: { id: 'attack' } };
    const conditions = [{ id: 'self_hp', scope: 'Self', label: 'Self HP', params: [] }];
    const actions = [{ id: 'attack', label: 'Attack current target', params: [] }, { id: 'use_skill', label: 'Use skill...', params: [{ name: 'skillId', type: 'skillRef' }] }, { id: 'use_item', label: 'Use item...', params: [{ name: 'itemId', type: 'itemRef' }] }];
    await TestBed.configureTestingModule({ imports: [GambitEditorComponent], providers: [
      { provide: ApiService, useValue: { get: (url: string) => of(url === '/gambits' ? [{ id: 'page', title: 'Page', lines: [line] }] : []) } },
      { provide: CharacterStore, useValue: { character: () => ({ knownItemIds: ['potion'] }) } },
      { provide: InventoryStore, useValue: { load: async () => {}, equipment: () => [] } },
      { provide: CatalogService, useValue: { gambits: () => ({ conditions, actions }), items: () => [{ id: 'potion', name: 'Potion', type: 'consumable', effect: { type: 'heal_hp' } }], item: () => null, skills: () => [], load: async () => {} } },
      { provide: CombatActionsStore, useValue: { feedback: () => [], serverActions: () => [], page: () => null, busy: () => false } },
      { provide: PartyStore, useValue: { actions: () => [] } },
      { provide: BrowserNotificationsService, useValue: { hasAcknowledged: () => true, acknowledge: async () => {} } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(GambitEditorComponent);
    await fixture.whenStable(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('.action-block > select');
    for (const key of ['use_item:self', 'use_skill', 'attack']) {
      select.value = key; select.dispatchEvent(new Event('change')); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      const selectedOption = select.selectedOptions[0];
      fixture.detectChanges();
      expect(select.selectedOptions[0]).withContext('option remains stable during updates: ' + key).toBe(selectedOption);
      expect(select.value).withContext(key).toBe(key);
      expect(fixture.componentInstance.actionKey(line)).toBe(key);
    }
  });
});
