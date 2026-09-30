import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LoginMusicControlComponent],
  template: `
    <div class="auth-screen"><app-login-music-control />
      <div class="auth-panel ml-5">
        <h1 class="text-3xl font-bold text-white text-center mb-8">Esqueci minha senha</h1>

        @if (success()) {
          <div class="space-y-6">
            <div class="mx-auto h-16 w-16 bg-green-900/50 rounded-full flex items-center justify-center">
              <svg class="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white mb-2">E-mail enviado!</h2>
              <p class="text-gray-400 mb-6">{{ message() }}</p>
            </div>
            <a
              routerLink="/login"
              class="auth-button auth-button-inline"
            >
              Voltar ao login
            </a>
          </div>
        } @else {
          @if (error()) {
            <div class="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm">
              {{ error() }}
            </div>
          }

          <form (ngSubmit)="onSubmit()" #forgotForm="ngForm" class="space-y-5">
            <div>
              <label for="email" class="block text-sm font-medium text-gray-300 mb-1">E-mail</label>
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

            <button
              type="submit"
              [disabled]="isLoading() || forgotForm.invalid"
              class="auth-button"
            >
              @if (isLoading()) {
                <span class="flex items-center justify-center gap-2">
                  <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Enviando...
                </span>
              } @else {
                Enviar link de redefinição
              }
            </button>
          </form>

          <p class="mt-6 text-center text-gray-400 text-sm">
            Lembrou a senha? <a routerLink="/login" class="auth-link">Entrar</a>
          </p>
        }
      </div>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  form = {
    email: '',
  };

  isLoading = this.authStore.isLoading;
  error = this.authStore.error;
  success = signal<boolean>(false);
  message = signal<string>('');

  onSubmit(): void {
    const { email } = this.form;
    this.authStore.forgotPassword(email).subscribe({
      next: (response) => {
        this.success.set(true);
        this.message.set(response.message);
      },
      error: () => {},
    });
  }
}