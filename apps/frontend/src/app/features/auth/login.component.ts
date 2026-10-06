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
          <button type="button" class="auth-button" (click)="loginWithGoogle()">Continuar com Google</button>

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