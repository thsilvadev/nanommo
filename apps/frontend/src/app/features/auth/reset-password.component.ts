import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LoginMusicControlComponent],
  template: `
    <div class="auth-screen"><app-login-music-control />
      <div class="auth-panel">
        <h1 class="text-3xl font-bold text-white text-center mb-8">Redefinir senha</h1>

        @if (success()) {
          <div class="space-y-6 text-center">
            <div class="mx-auto h-16 w-16 bg-green-900/50 rounded-full flex items-center justify-center">
              <svg class="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 class="text-2xl font-bold text-white mb-2">Senha redefinida com sucesso!</h2>
              <p class="text-gray-400 mb-6">{{ message() }}</p>
            </div>
            <a
              routerLink="/login"
              class="auth-button auth-button-inline"
            >
              Fazer login
            </a>
          </div>
        } @else {
          @if (error()) {
            <div class="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm">
              {{ error() }}
            </div>
          }

          <form (ngSubmit)="onSubmit()" #resetForm="ngForm" class="space-y-5">
            <div>
              <label for="password" class="block text-sm font-medium text-gray-300 mb-1">Nova senha</label>
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
              <label for="confirmPassword" class="block text-sm font-medium text-gray-300 mb-1">Confirmar nova senha</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                [(ngModel)]="form.confirmPassword"
                required
                #confirmPasswordInput="ngModel"
                class="auth-input"
                placeholder="Confirme a nova senha"
              />
              @if (confirmPasswordInput.invalid && (confirmPasswordInput.dirty || confirmPasswordInput.touched)) {
                <p class="mt-1 text-sm text-red-400">Confirmação de senha é obrigatória</p>
              }
              @if (passwordMismatch()) {
                <p class="mt-1 text-sm text-red-400">As senhas não coincidem</p>
              }
            </div>

            <button
              type="submit"
              [disabled]="isLoading() || resetForm.invalid || passwordMismatch()"
              class="auth-button"
            >
              @if (isLoading()) {
                <span class="flex items-center justify-center gap-2">
                  <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Redefinindo...
                </span>
              } @else {
                Redefinir senha
              }
            </button>
          </form>

          <div class="mt-6 space-y-3">
            <a
              routerLink="/forgot-password"
              class="auth-link auth-link-block"
            >
              Solicitar novo link de redefinição
            </a>
            <a
              routerLink="/login"
              class="auth-link auth-link-block muted"
            >
              Voltar ao login
            </a>
          </div>
        }
      </div>
    </div>
  `,
})
export class ResetPasswordComponent implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  form = {
    password: '',
    confirmPassword: '',
  };

  isLoading = this.authStore.isLoading;
  error = signal<string | null>(null);
  success = signal<boolean>(false);
  message = signal<string>('');
  passwordMismatch = signal<boolean>(false);
  private token: string | null = null;

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      this.token = params['token'] || null;
      if (!this.token) {
        this.error.set('Token de redefinição não fornecido na URL.');
      }
    });
  }

  onSubmit(): void {
    if (!this.token) {
      this.error.set('Token de redefinição não fornecido.');
      return;
    }

    if (this.form.password !== this.form.confirmPassword) {
      this.passwordMismatch.set(true);
      return;
    }

    this.passwordMismatch.set(false);
    this.error.set(null);
    this.authStore.resetPassword(this.token, this.form.password).subscribe({
      next: (response) => {
        if (response.success) {
          this.success.set(true);
          this.message.set(response.message);
        } else {
          this.error.set(response.message || 'Falha ao redefinir senha.');
        }
      },
      error: (err) => {
        const message = err.error?.message || 'Token inválido ou expirado.';
        this.error.set(message);
      },
    });
  }
}