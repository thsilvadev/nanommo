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
    map(() => {
      if (authStore.userPayload()?.emailVerified === false) {
        return router.createUrlTree(['/verify-email-pending']);
      }
      if (characterStore.character()) {
        return true;
      }
      return router.createUrlTree(['/create-character']);
    }),
    catchError(() => of(router.createUrlTree(['/create-character']))),
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
    map(() => {
      if (authStore.userPayload()?.emailVerified === false) {
        return router.createUrlTree(['/verify-email-pending']);
      }
      if (characterStore.character()) {
        return router.createUrlTree(['/play']);
      }
      return true;
    }),
    catchError(() => of(true)),
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
    map(() => {
      if (characterStore.character()) {
        return router.createUrlTree(['/play']);
      }
      return router.createUrlTree(['/create-character']);
    }),
    catchError(() => of(router.createUrlTree(['/create-character']))),
  );
};

function ensureCharacterLoaded(characterStore: CharacterStore): Promise<void> {
  if (characterStore.character()) {
    return Promise.resolve();
  }
  return characterStore.load().then(() => undefined).catch(() => undefined);
}