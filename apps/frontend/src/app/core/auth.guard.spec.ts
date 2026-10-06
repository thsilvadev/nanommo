import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { of } from 'rxjs';
import { AuthStore } from './auth.store';
import { CharacterStore } from './game.store';
import { authGuard, characterGuard, createCharacterGuard, guestGuard } from './auth.guard';
import { Character } from './game.models';

function fakeCharacter(name = 'Tester'): Character {
  return {
    id: 'char-1', userId: 'user-1', name, level: 1, xp: 0, xpToNext: 10,
    unspentAttributePoints: 0, str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5,
    attributeBonuses: {}, gold: 0, hpCurrent: 100, spCurrent: 50, maxHp: 100, maxSp: 50,
    attack: 10, magicAttack: 0, defense: 0, attackSpeed: 1, castSpeed: 1, evasion: 5,
    accuracy: 5, hpRegenPerTenTicks: 3, spRegenPerTenTicks: 3, criticalChance: 1,
    hungry: false, diet: [], dietLevels: {}, autoFeed: false, status: 'town',
    lastSeenAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), stateVersion: 1,
  } as Character;
}

describe('auth guards', () => {
  let authStore: jasmine.SpyObj<AuthStore>;
  let characterStore: jasmine.SpyObj<CharacterStore>;
  let router: jasmine.SpyObj<Router>;
  let createdTrees: string[];

  beforeEach(() => {
    createdTrees = [];
    authStore = jasmine.createSpyObj<AuthStore>('AuthStore', ['routeAfterLogin']);
    characterStore = jasmine.createSpyObj<CharacterStore>('CharacterStore', ['load']);
    router = jasmine.createSpyObj<Router>('Router', ['createUrlTree']);
    router.createUrlTree.and.callFake((commands: any[]) => {
      const tree = { __commands: commands } as unknown as UrlTree;
      createdTrees.push(JSON.stringify(commands));
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
    const result = guard({}, { url: '/play' });
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
  });

  describe('authGuard', () => {
    it('allows authenticated users', () => {
      (authStore.isAuthenticated as any) = () => true;
      expect(authGuard({} as any, { url: '/play' } as any)).toBe(true);
    });

    it('redirects unauthenticated users to /login', () => {
      (authStore.isAuthenticated as any) = () => false;
      const result = authGuard({} as any, { url: '/play' } as any);
      expect(createdTrees).toContain(JSON.stringify(['/login']));
    });
  });
});
