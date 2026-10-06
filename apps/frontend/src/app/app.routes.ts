import { Routes } from '@angular/router';
import { authGuard, guestGuard, characterGuard, createCharacterGuard } from './core/auth.guard';

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
    path: 'create-character',
    loadComponent: () => import('./features/auth/create-character.component').then((m) => m.CreateCharacterComponent),
    canActivate: [createCharacterGuard],
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./features/auth/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'verify-email-pending',
    loadComponent: () => import('./features/auth/email-verification-pending.component').then((m) => m.EmailVerificationPendingComponent),
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
    canActivate: [characterGuard],
    children: [
      { path: '', redirectTo: 'grind', pathMatch: 'full' },
      { path: 'grind', loadComponent: () => import('./features/play/grind.component').then((m) => m.GrindComponent) },
      { path: 'character', loadComponent: () => import('./features/character/character-page.component').then((m) => m.CharacterPageComponent) },
      { path: 'gambits', loadComponent: () => import('./features/character/character-page.component').then((m) => m.CharacterPageComponent), data: { defaultTab: 'gambits' } },
    ],
  },
  {
    path: '**',
    redirectTo: '/login',
  },
];