import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthStore } from './auth.store';
import { CharacterStore } from './game.store';
import { from, of, Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route, state) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (authStore.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const characterGuard: CanActivateFn = (route, state): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const authStore = inject(AuthStore);
  const characterStore = inject(CharacterStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  return from(ensureCharacterLoaded(characterStore)).pipe(
    map((loaded) => {
      if (authStore.userPayload()?.emailVerified === false) {
        return router.createUrlTree(['/verify-email-pending']);
      }
      if (!loaded) return characterLoadErrorTree(router, state.url);
      if (characterStore.character()) return true;
      return router.createUrlTree(['/create-character']);
    }),
    catchError(() => of(characterLoadErrorTree(router, state.url))),
  );
};

export const createCharacterGuard: CanActivateFn = (route, state): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const authStore = inject(AuthStore);
  const characterStore = inject(CharacterStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  return from(ensureCharacterLoaded(characterStore)).pipe(
    map((loaded) => {
      if (authStore.userPayload()?.emailVerified === false) {
        return router.createUrlTree(['/verify-email-pending']);
      }
      if (!loaded) return characterLoadErrorTree(router, state.url);
      if (characterStore.character()) {
        return router.createUrlTree(['/play']);
      }
      return true;
    }),
    catchError(() => of(characterLoadErrorTree(router, state.url))),
  );
};

export const guestGuard: CanActivateFn = (route, state): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const authStore = inject(AuthStore);
  const characterStore = inject(CharacterStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return true;
  }

  return from(ensureCharacterLoaded(characterStore)).pipe(
    map((loaded) => {
      if (!loaded) return characterLoadErrorTree(router, state.url);
      if (characterStore.character()) {
        return router.createUrlTree(['/play']);
      }
      return router.createUrlTree(['/create-character']);
    }),
    catchError(() => of(characterLoadErrorTree(router, state.url))),
  );
};

/**
 * CharacterStore.load() deliberately records failures in its state instead of throwing.
 * Only a successful, loaded response with no Character means that character creation is
 * appropriate; a failed or interrupted load must never be interpreted as a missing save.
 */
async function ensureCharacterLoaded(characterStore: CharacterStore): Promise<boolean> {
  if (characterStore.character()) return true;
  await characterStore.load();
  return characterStore.state() === 'loaded';
}

function characterLoadErrorTree(router: Router, returnUrl: string): UrlTree {
  return router.createUrlTree(['/error'], {
    queryParams: { reason: 'character-load', returnUrl },
  });
}
