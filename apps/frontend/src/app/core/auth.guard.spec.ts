import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { of } from 'rxjs';
import { AuthStore } from './auth.store';
import { CharacterStore } from './game.store';
import { authGuard, characterGuard, createCharacterGuard, guestGuard } from './auth.guard';
import { Character } from './game.models';

function fakeCharacter(name = 'Tester'): Character {
  return {
    id: 'char-1', userId: 'user-1', name, dominantHand: 'right', level: 1, xp: 0, xpToNext: 10,
    unspentAttributePoints: 0, str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5,
    attributeBonuses: {}, gold: 0, hpCurrent: 100, spCurrent: 50, maxHp: 100, maxSp: 50,
    attack: 10, magicAttack: 0, defense: 0, attackSpeed: 1, castTimeReduction: 10, evasion: 5,
    accuracy: 5, hpRegenPerTenTicks: 3, spRegenPerTenTicks: 3, criticalChance: 1,
    hungry: false, diet: [], dietLevels: {}, autoFeed: false, status: 'town', currentMapId: 'map_town',
    lastSeenAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), stateVersion: 1,
  } as Character;
}

describe('auth guards', () => {
  let authStore: jasmine.SpyObj<AuthStore>;
  let characterStore: jasmine.SpyObj<CharacterStore>;
  let router: jasmine.SpyObj<Router>;
  let createdTrees: string[];
  let createdTreeOptions: any[];

  beforeEach(() => {
    createdTrees = [];
    createdTreeOptions = [];
    authStore = {
      isAuthenticated: jasmine.createSpy('isAuthenticated'),
      userPayload: jasmine.createSpy('userPayload').and.returnValue({ emailVerified: true }),
    } as unknown as jasmine.SpyObj<AuthStore>;
    characterStore = {
      character: jasmine.createSpy('character'),
      load: jasmine.createSpy('load'),
      state: jasmine.createSpy('state').and.returnValue('loaded'),
    } as unknown as jasmine.SpyObj<CharacterStore>;
    router = jasmine.createSpyObj<Router>('Router', ['createUrlTree']);
    router.createUrlTree.and.callFake((commands: any[], options?: any) => {
      const tree = { __commands: commands, __options: options } as unknown as UrlTree;
      createdTrees.push(JSON.stringify(commands));
      createdTreeOptions.push(options);
      return tree;
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: authStore },
        { provide: CharacterStore, useValue: characterStore },
        { provide: Router, useValue: router },
      ],
    });
  });

  function runGuard(guard: any): Promise<any> {
    const result = TestBed.runInInjectionContext(() => guard({}, { url: '/play' }));
    if (result instanceof Promise) return result;
    if (result && typeof (result as any).subscribe === 'function') {
      return (result as any).toPromise();
    }
    return Promise.resolve(result);
  }

  describe('characterGuard (/play)', () => {
    it('redirects unauthenticated users to /login', async () => {
      (authStore.isAuthenticated as any) = () => false;
      const result = await runGuard(characterGuard);
      expect(createdTrees).toContain(JSON.stringify(['/login']));
      expect(result).toBeDefined();
    });

    it('redirects authenticated users without a character to /create-character', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(null);
      characterStore.load.and.returnValue(Promise.resolve());
      const result = await runGuard(characterGuard);
      expect(createdTrees).toContain(JSON.stringify(['/create-character']));
    });

    it('allows authenticated users with a character', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(fakeCharacter());
      characterStore.load.and.returnValue(Promise.resolve());
      const result = await runGuard(characterGuard);
      expect(result).toBe(true);
    });

    it('redirects a failed character load to the error page, not character creation', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(null);
      characterStore.load.and.returnValue(Promise.resolve());
      (characterStore.state as any).and.returnValue('error');

      const result = await runGuard(characterGuard) as any;

      expect(result.__commands).toEqual(['/error']);
      expect(result.__options.queryParams.reason).toBe('character-load');
      expect(result.__options.queryParams.returnUrl).toBe('/play');
      expect(createdTrees).not.toContain(JSON.stringify(['/create-character']));
    });
  });

  describe('createCharacterGuard (/create-character)', () => {
    it('redirects unauthenticated users to /login', async () => {
      (authStore.isAuthenticated as any) = () => false;
      const result = await runGuard(createCharacterGuard);
      expect(createdTrees).toContain(JSON.stringify(['/login']));
    });

    it('redirects authenticated users with a character to /play', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(fakeCharacter());
      characterStore.load.and.returnValue(Promise.resolve());
      const result = await runGuard(createCharacterGuard);
      expect(createdTrees).toContain(JSON.stringify(['/play']));
    });

    it('allows authenticated users without a character', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(null);
      characterStore.load.and.returnValue(Promise.resolve());
      const result = await runGuard(createCharacterGuard);
      expect(result).toBe(true);
    });

    it('does not allow character creation when the character load failed', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(null);
      characterStore.load.and.returnValue(Promise.resolve());
      (characterStore.state as any).and.returnValue('error');

      const result = await runGuard(createCharacterGuard) as any;

      expect(result.__commands).toEqual(['/error']);
      expect(result.__options.queryParams.reason).toBe('character-load');
    });
  });

  describe('guestGuard (/login, /register)', () => {
    it('allows unauthenticated users', async () => {
      (authStore.isAuthenticated as any) = () => false;
      const result = await runGuard(guestGuard);
      expect(result).toBe(true);
    });

    it('redirects authenticated users with a character to /play', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(fakeCharacter());
      characterStore.load.and.returnValue(Promise.resolve());
      const result = await runGuard(guestGuard);
      expect(createdTrees).toContain(JSON.stringify(['/play']));
    });

    it('redirects authenticated users without a character to /create-character', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(null);
      characterStore.load.and.returnValue(Promise.resolve());
      const result = await runGuard(guestGuard);
      expect(createdTrees).toContain(JSON.stringify(['/create-character']));
    });

    it('redirects a failed character load to the error page', async () => {
      (authStore.isAuthenticated as any) = () => true;
      characterStore.character.and.returnValue(null);
      characterStore.load.and.returnValue(Promise.resolve());
      (characterStore.state as any).and.returnValue('error');

      const result = await runGuard(guestGuard) as any;

      expect(result.__commands).toEqual(['/error']);
      expect(result.__options.queryParams.reason).toBe('character-load');
    });
  });

  describe('authGuard', () => {
    it('allows authenticated users', () => {
      (authStore.isAuthenticated as any) = () => true;
      expect(TestBed.runInInjectionContext(() => authGuard({} as any, { url: '/play' } as any))).toBe(true);
    });

    it('redirects unauthenticated users to /login', () => {
      (authStore.isAuthenticated as any) = () => false;
      const result = TestBed.runInInjectionContext(() => authGuard({} as any, { url: '/play' } as any));
      expect(createdTrees).toContain(JSON.stringify(['/login']));
    });
  });
});
