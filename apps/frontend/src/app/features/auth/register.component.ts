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

        <div class="my-4 text-center text-gray-400">ou</div>
          <button type="button" class="auth-button" (click)="loginWithGoogle()">Continuar com Google</button>

          <form (ngSubmit)="onSubmit()" #registerForm="ngForm" class="space-y-1">
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
    email: '',
    password: '',
  };

  isLoading = this.authStore.isLoading;
  error = this.authStore.error;

  loginWithGoogle(): void { this.authStore.loginWithGoogle(); }

  onSubmit(): void {
    const { email, password } = this.form;
    this.authStore.register(email, password).subscribe({
      next: () => {
        this.router.navigate(['/verify-email-pending'], { queryParams: { email } });
      },
      error: () => {},
    });
  }
}