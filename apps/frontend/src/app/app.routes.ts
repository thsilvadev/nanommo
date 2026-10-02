import { Routes, CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { authGuard, guestGuard } from './core/auth.guard';
import { ViewportService } from './core/viewport.service';

const mobileDesktopTarget: Record<string,string> = {
  '/play/m/battle': '/play/grind',
  '/play/m/map': '/play/grind',
  '/play/m/items': '/play/grind',
  '/play/m/gambits': '/play/gambits',
  '/play/m/character': '/play/character?tab=character',
};

const mobileRouteGuard: CanActivateFn = (_, state) => {
  if (inject(ViewportService).isMobile()) return true;
  return inject(Router).parseUrl(mobileDesktopTarget[state.url.split('?')[0]] ?? '/play/grind');
};

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./features/auth/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'verify-email-pending',
    loadComponent: () => import('./features/auth/email-verification-pending.component').then((m) => m.EmailVerificationPendingComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/auth/forgot-password.component').then((m) => m.ForgotPasswordComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/auth/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: 'play',
    loadComponent: () => import('./features/play/play.component').then((m) => m.PlayComponent),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'grind', pathMatch: 'full' },
      { path: 'm/battle', canActivate: [mobileRouteGuard], loadComponent: () => import('./features/play/grind.component').then((m) => m.GrindComponent) },
      { path: 'm/map', canActivate: [mobileRouteGuard], loadComponent: () => import('./features/play/components').then((m) => m.MapBoard) },
      { path: 'm/items', canActivate: [mobileRouteGuard], loadComponent: () => import('./features/play/mobile-items.component').then((m) => m.MobileItemsComponent) },
      { path: 'character', loadComponent: () => import('./features/character/character-page.component').then((m) => m.CharacterPageComponent) },
      { path: 'gambits', loadComponent: () => import('./features/character/character-page.component').then((m) => m.CharacterPageComponent), data: { defaultTab: 'gambits' } },
      { path: 'm/character', canActivate: [mobileRouteGuard], loadComponent: () => import('./features/character/character-page.component').then((m) => m.CharacterPageComponent) },
      { path: 'm/gambits', canActivate: [mobileRouteGuard], loadComponent: () => import('./features/gambit/gambit-editor.component').then((m) => m.GambitEditorComponent) },
      { path: 'grind', loadComponent: () => import('./features/play/grind.component').then((m) => m.GrindComponent) },
    ],
  },
  {
    path: '**',
    redirectTo: '/login',
  },
];