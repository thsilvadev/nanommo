import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';
import { LoginMusicService } from '../../shared/login-music.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LoginMusicControlComponent],
  template: `
    <div class="auth-screen auth-login-screen"><app-login-music-control /><div class="auth-login-fade" aria-hidden="true"></div>
      <div class="auth-panel ml-5">


        @if (error()) {
          <div class="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm">
            {{ error() }}
          </div>
        }

        @if (returnUrlReason() === 'session_expired') {
          <div class="mb-6 p-4 bg-yellow-900/50 border border-yellow-700 text-yellow-200 rounded-lg text-sm">
            Sua sessão expirou. Faça login novamente.
          </div>
        }

        <div class="my-4 text-center text-gray-400">ou</div>
          <button type="button" class="google-auth-button" (click)="loginWithGoogle()" aria-label="Continuar com Google">
            <svg class="google-logo" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#EA4335" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
              <path fill="#4285F4" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.258c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.714H.958v2.331A9 9 0 0 0 9 18Z"/>
              <path fill="#FBBC05" d="M3.964 10.708A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.284-1.708V4.961H.958A9 9 0 0 0 0 9c0 1.452.348 2.826.958 4.039l3.006-2.331Z"/>
              <path fill="#34A853" d="M9 3.578c1.321 0 2.507.454 3.441 1.346l2.582-2.582C13.463.892 11.427 0 9 0A9 9 0 0 0 .958 4.961l3.006 2.331C4.672 5.162 6.656 3.578 9 3.578Z"/>
            </svg>
            <span>Continuar com Google</span>
          </button>

          <form (ngSubmit)="onSubmit()" #loginForm="ngForm" class="space-y-5">
          <div>
            <label for="identifier" class="block text-sm font-medium text-gray-300 mb-1">E-mail ou nome do personagem</label>
            <input
              type="text"
              id="identifier"
              name="identifier"
              [(ngModel)]="form.identifier"
              required
              #identifierInput="ngModel"
              class="auth-input"
              placeholder="Seu e-mail ou nome do personagem"
            />
            @if (identifierInput.invalid && (identifierInput.dirty || identifierInput.touched)) {
              <p class="mt-1 text-sm text-red-400">E-mail ou nome do personagem é obrigatório</p>
            }
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-gray-300 mb-1">Senha</label>
            <input
              type="password"
              id="password"
              name="password"
              [(ngModel)]="form.password"
              required
              #passwordInput="ngModel"
              class="auth-input"
              placeholder="Sua senha"
            />
            @if (passwordInput.invalid && (passwordInput.dirty || passwordInput.touched)) {
              <p class="mt-1 text-sm text-red-400">Senha é obrigatória</p>
            }
          </div>

          <button
            type="submit"
            [disabled]="isLoading() || loginForm.invalid"
            class="auth-button"
          >
            @if (isLoading()) {
              <span class="flex items-center justify-center gap-2">
                <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Entrando...
              </span>
            } @else {
              Entrar
            }
          </button>

          <p class="mt-4 text-center text-sm">
            <a routerLink="/forgot-password" class="auth-link">Esqueci minha senha</a>
          </p>
        </form>

        <p class="mt-6 text-center text-gray-400 text-sm">
          Não tem conta? <a routerLink="/register" class="auth-link">Criar conta</a>
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly music = inject(LoginMusicService);

  form = {
    identifier: '',
    password: '',
  };

  isLoading = this.authStore.isLoading;
  error = this.authStore.error;

  returnUrlReason = signal<string | null>(null);

  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    this.returnUrlReason.set(urlParams.get('reason'));
  }

  loginWithGoogle(): void { this.authStore.loginWithGoogle(); }

  onSubmit(): void {
    const { identifier, password } = this.form;
    this.authStore.login(identifier, password).subscribe({
      next: async () => {
        await this.music.fadeOut(2000);
        const destination = this.authStore.routeAfterLogin();
        await this.router.navigate([destination]);
      },
      error: () => {},
    });
  }
}