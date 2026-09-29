import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth.store';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div class="w-full max-w-md bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
        <h1 class="text-3xl font-bold text-white text-center mb-8">Entrar</h1>

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

        <form (ngSubmit)="onSubmit()" #loginForm="ngForm" class="space-y-5">
          <div>
            <label for="username" class="block text-sm font-medium text-gray-300 mb-1">Nome de Usuário</label>
            <input
              type="text"
              id="username"
              name="username"
              [(ngModel)]="form.username"
              required
              #usernameInput="ngModel"
              class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Seu nome de usuário"
            />
            @if (usernameInput.invalid && (usernameInput.dirty || usernameInput.touched)) {
              <p class="mt-1 text-sm text-red-400">Nome de usuário é obrigatório</p>
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
              class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Sua senha"
            />
            @if (passwordInput.invalid && (passwordInput.dirty || passwordInput.touched)) {
              <p class="mt-1 text-sm text-red-400">Senha é obrigatória</p>
            }
          </div>

          <button
            type="submit"
            [disabled]="isLoading() || loginForm.invalid"
            class="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
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
            <a routerLink="/forgot-password" class="text-blue-400 hover:text-blue-300 font-medium">Esqueci minha senha</a>
          </p>
        </form>

        <p class="mt-6 text-center text-gray-400 text-sm">
          Não tem conta? <a routerLink="/register" class="text-blue-400 hover:text-blue-300 font-medium">Criar conta</a>
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  form = {
    username: '',
    password: '',
  };

  isLoading = this.authStore.isLoading;
  error = this.authStore.error;

  returnUrlReason = signal<string | null>(null);

  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    this.returnUrlReason.set(urlParams.get('reason'));
  }

  onSubmit(): void {
    const { username, password } = this.form;
    this.authStore.login(username, password).subscribe({
      next: () => {
        this.router.navigate(['/play']);
      },
      error: () => {},
    });
  }
}

import { signal } from '@angular/core';