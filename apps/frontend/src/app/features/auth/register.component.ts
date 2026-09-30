import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LoginMusicControlComponent],
  template: `
    <div class="auth-screen"><app-login-music-control />
      <div class="auth-panel ml-5">

        @if (error()) {
          <div class="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm">
            {{ error() }}
          </div>
        }

        <form (ngSubmit)="onSubmit()" #registerForm="ngForm" class="space-y-1">
          <div>
            <label for="username" class="block text-sm font-medium text-gray-300">Nome de Usuário</label>
            <input
              type="text"
              id="username"
              name="username"
              [(ngModel)]="form.username"
              required
              minlength="3"
              maxlength="16"
              #usernameInput="ngModel"
              class="auth-input"
              placeholder="Seu nome no jogo (3-16 caracteres)"
            />
            @if (usernameInput.invalid && (usernameInput.dirty || usernameInput.touched)) {
              <p class="mt-1 text-sm text-red-400">Nome de usuário deve ter 3-16 caracteres</p>
            }
          </div>

          <div>
            <label for="email" class="block text-sm font-medium text-gray-300">E-mail</label>
            <input
              type="email"
              id="email"
              name="email"
              [(ngModel)]="form.email"
              required
              email
              #emailInput="ngModel"
              class="auth-input"
              placeholder="seu@email.com"
            />
            @if (emailInput.invalid && (emailInput.dirty || emailInput.touched)) {
              <p class="mt-1 text-sm text-red-400">E-mail inválido</p>
            }
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-gray-300">Senha</label>
            <input
              type="password"
              id="password"
              name="password"
              [(ngModel)]="form.password"
              required
              minlength="8"
              #passwordInput="ngModel"
              class="auth-input"
              placeholder="Mínimo 8 caracteres"
            />
            @if (passwordInput.invalid && (passwordInput.dirty || passwordInput.touched)) {
              <p class="mt-1 text-sm text-red-400">Senha deve ter pelo menos 8 caracteres</p>
            }
          </div>

          <div>
            <label for="cpf" class="block text-sm font-medium text-gray-300">CPF</label>
            <input
              type="text"
              id="cpf"
              name="cpf"
              [(ngModel)]="form.cpf"
              required
              #cpfInput="ngModel"
              class="auth-input"
              placeholder="000.000.000-00"
              maxlength="14"
            />
            @if (cpfInput.invalid && (cpfInput.dirty || cpfInput.touched)) {
              <p class="mt-1 text-sm text-red-400">CPF é obrigatório</p>
            }
          </div>

          <button
            type="submit"
            [disabled]="isLoading() || registerForm.invalid"
            class="auth-button"
          >
            @if (isLoading()) {
              <span class="flex items-center justify-center gap-2">
                <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Criando conta...
              </span>
            } @else {
              Criar Conta
            }
          </button>
        </form>

        <p class="mt-6 text-center text-gray-400 text-sm">
          Já tem conta? <a routerLink="/login" class="auth-link">Entrar</a>
        </p>
      </div>
    </div>
  `,
})
export class RegisterComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  form = {
    username: '',
    email: '',
    password: '',
    cpf: '',
  };

  isLoading = this.authStore.isLoading;
  error = this.authStore.error;

  onSubmit(): void {
    const { username, email, password, cpf } = this.form;
    this.authStore.register(username, email, password, cpf).subscribe({
      next: () => {
        this.router.navigate(['/verify-email-pending'], { queryParams: { email } });
      },
      error: () => {},
    });
  }
}