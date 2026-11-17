import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { defaultAppearance, type AppearanceInput } from '@nanommo/shared';
import { CreateCharacterComponent } from './create-character.component';
import { AuthStore } from '../../core/auth.store';
import { CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { CHARACTER_VIEWER_ENV } from '../../shared/character-viewer/character-viewer.component';
import { Character } from '../../core/game.models';

function legacyCharacter(): Character {
  return {
    id: 'char-1', userId: 'user-1', name: 'Veteran', dominantHand: 'left',
    sex: null, height: null, heightCm: null, appearance: null,
    level: 12, str: 10, luk: 7, stateVersion: 4,
  } as unknown as Character;
}

describe('CreateCharacterComponent', () => {
  let fixture: ComponentFixture<CreateCharacterComponent>;
  let component: CreateCharacterComponent;
  let router: jasmine.SpyObj<Router>;
  let authStore: { createCharacter: jasmine.Spy; isLoading: () => boolean };
  let characterStore: { character: ReturnType<typeof signal<Character | null>>; setAppearance: jasmine.Spy; load: jasmine.Spy };

  async function setup(character: Character | null) {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    authStore = { createCharacter: jasmine.createSpy('createCharacter').and.returnValue(of({})), isLoading: () => false };
    characterStore = {
      character: signal<Character | null>(character),
      setAppearance: jasmine.createSpy('setAppearance').and.returnValue(Promise.resolve({})),
      load: jasmine.createSpy('load').and.returnValue(Promise.resolve()),
    };
    await TestBed.configureTestingModule({
      imports: [CreateCharacterComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: AuthStore, useValue: authStore },
        { provide: CharacterStore, useValue: characterStore },
        { provide: InventoryStore, useValue: { equipment: () => [{ slot: 'mainHand', itemId: 'equip_sword_t1' }, { slot: 'offHand', itemId: 'equip_shield_t1' }], load: () => Promise.resolve() } },
        { provide: CatalogService, useValue: { load: () => Promise.resolve(), item: (id: string) => ({ equip_sword_t1: { weaponType: 'sword' }, equip_shield_t1: { weaponType: 'shield' } } as any)[id] } },
        // No WebGL in this test: the preview reports failure immediately.
        { provide: CHARACTER_VIEWER_ENV, useValue: { assetBase: '/assets/character/', webglAvailable: () => false } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CreateCharacterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.ready;
    fixture.detectChanges();
  }

  const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  afterEach(() => TestBed.resetTestingModule());

  it('new character: name and hand are editable, and the preview holds the starter knife', async () => {
    await setup(null);
    expect(component.mode()).toBe('new');
    expect((el('[data-test=name]') as HTMLInputElement).disabled).toBeFalse();
    expect((el('[data-test=hand-left]') as HTMLInputElement).disabled).toBeFalse();
    expect(component.hands()).toEqual({ main: 'dagger', off: null });
  });

  it('existing character: name and hand are shown locked, and the preview holds the equipped items', async () => {
    await setup(legacyCharacter());
    expect(component.mode()).toBe('update');
    const name = el('[data-test=name]') as HTMLInputElement;
    expect(name.value).toBe('Veteran');
    expect(name.disabled).toBeTrue();
    expect((el('[data-test=hand-left]') as HTMLInputElement).checked).toBeTrue();
    expect((el('[data-test=hand-right]') as HTMLInputElement).disabled).toBeTrue();
    expect(component.hands()).toEqual({ main: 'sword', off: 'shield' });
  });

  it('shows the height in metres and its STR/LUK effect at every band boundary', async () => {
    await setup(null);
    const cases: Array<[number, string]> = [
      [145, 'STR −2 · LUK +2'], [146, 'STR −1 · LUK +1'], [175, 'STR −1 · LUK +1'],
      [176, 'STR +1 · LUK −1'], [204, 'STR +1 · LUK −1'], [205, 'STR +2 · LUK −2'],
    ];
    for (const [cm, label] of cases) {
      component.setHeight(cm);
      fixture.detectChanges();
      expect(el('[data-test=adjustment]')!.textContent!.trim()).withContext(String(cm)).toBe(label);
    }
    component.setHeight(178);
    fixture.detectChanges();
    expect(el('[data-test=height-value]')!.textContent).toContain('1.78');
  });

  it('switching sex resets only the traits whose options depend on sex', async () => {
    await setup(null);
    for (const trait of ['hair', 'face', 'nose', 'mouth', 'mouthDetails', 'chest', 'facialHair', 'skin', 'hairColor', 'piercing', 'tattoo'] as const) {
      component.pick(trait, 2);
    }
    component.setHeight(190);
    component.setSex('female');
    const a = component.appearance();
    for (const trait of ['hair', 'face', 'nose', 'mouth', 'mouthDetails', 'chest', 'facialHair'] as const) expect(a[trait]).withContext(trait).toBe(0);
    for (const trait of ['skin', 'hairColor', 'piercing', 'tattoo'] as const) expect(a[trait]).withContext(trait).toBe(2);
    expect(component.heightCm()).toBe(190);
  });

  it('steps wrap around within the options available for the current sex', async () => {
    await setup(null);
    const hairCount = component.options('hair').length;
    component.step('hair', -1);
    expect(component.appearance().hair).toBe(hairCount - 1);
    component.step('hair', 1);
    expect(component.appearance().hair).toBe(0);
  });

  it('asks for confirmation before saving, and cancelling saves nothing', async () => {
    await setup(null);
    component.form.name = 'Hero1';
    fixture.detectChanges();
    (el('[data-test=confirm]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(authStore.createCharacter).not.toHaveBeenCalled();
    expect(el('[data-test=confirm-dialog]')).not.toBeNull();
    (el('[data-test=cancel]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el('[data-test=confirm-dialog]')).toBeNull();
    expect(authStore.createCharacter).not.toHaveBeenCalled();
  });

  it('creates a new character with name, hand and appearance', async () => {
    await setup(null);
    component.form.name = 'Hero1';
    component.form.dominantHand = 'left';
    component.setSex('female');
    component.setHeight(205);
    component.pick('hair', 1);
    component.requestConfirm();
    await component.submit();
    const expected: AppearanceInput = { sex: 'female', heightCm: 205, appearance: { ...defaultAppearance(), hair: 1 } };
    expect(authStore.createCharacter).toHaveBeenCalledWith('Hero1', 'left', expected);
    expect(router.navigate).toHaveBeenCalledWith(['/play']);
  });

  it('saves only sex, height and appearance for an existing character', async () => {
    await setup(legacyCharacter());
    component.setHeight(150);
    component.requestConfirm();
    await component.submit();
    expect(characterStore.setAppearance).toHaveBeenCalledWith({ sex: 'male', heightCm: 150, appearance: defaultAppearance() });
    expect(router.navigate).toHaveBeenCalledWith(['/play']);
  });

  it('an existing character that already saved elsewhere (409) reloads and continues', async () => {
    await setup(legacyCharacter());
    characterStore.setAppearance.and.returnValue(Promise.reject({ status: 409 }));
    component.requestConfirm();
    await component.submit();
    expect(characterStore.load).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/play']);
  });

  it('a taken name (409) on a new character shows an error and stays', async () => {
    await setup(null);
    authStore.createCharacter.and.returnValue(throwError(() => ({ status: 409 })));
    component.form.name = 'Taken1';
    component.requestConfirm();
    await component.submit();
    fixture.detectChanges();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(el('[data-test=error]')).not.toBeNull();
    expect(component.confirming()).toBeFalse();
  });

  it('keeps the controls usable when the 3D preview is unavailable', async () => {
    await setup(null);
    expect(component.previewFailed()).toBeTrue();
    expect(el('[data-test=preview-retry]')).not.toBeNull();
    expect((el('[data-test=confirm]') as HTMLButtonElement).disabled).toBeTrue(); // no name yet
    component.form.name = 'Hero1';
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((el('[data-test=confirm]') as HTMLButtonElement).disabled).toBeFalse();
  });
});
