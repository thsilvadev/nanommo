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
          <button type="button" class="google-auth-button" (click)="loginWithGoogle()" aria-label="Continuar com Google">
            <svg class="google-logo" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#EA4335" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
              <path fill="#4285F4" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.258c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.714H.958v2.331A9 9 0 0 0 9 18Z"/>
              <path fill="#FBBC05" d="M3.964 10.708A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.284-1.708V4.961H.958A9 9 0 0 0 0 9c0 1.452.348 2.826.958 4.039l3.006-2.331Z"/>
              <path fill="#34A853" d="M9 3.578c1.321 0 2.507.454 3.441 1.346l2.582-2.582C13.463.892 11.427 0 9 0A9 9 0 0 0 .958 4.961l3.006 2.331C4.672 5.162 6.656 3.578 9 3.578Z"/>
            </svg>
            <span>Continuar com Google</span>
          </button>

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