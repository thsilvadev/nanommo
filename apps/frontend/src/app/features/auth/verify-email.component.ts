import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthStore } from '../../core/auth.store';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div class="w-full max-w-md bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700 text-center">
        
        @if (state() === 'loading') {
          <div class="space-y-6">
            <svg class="animate-spin h-12 w-12 text-blue-400 mx-auto" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <div>
              <h1 class="text-2xl font-bold text-white mb-2">Verificando e-mail...</h1>
              <p class="text-gray-400">Aguarde enquanto confirmamos seu endereço de e-mail.</p>
            </div>
          </div>
        }

        @if (state() === 'success') {
          <div class="space-y-6">
            <div class="mx-auto h-16 w-16 bg-green-900/50 rounded-full flex items-center justify-center">
              <svg class="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h1 class="text-2xl font-bold text-white mb-2">E-mail confirmado!</h1>
              <p class="text-gray-400 mb-6">Seu e-mail foi verificado com sucesso. Agora volte para o login para entrar no jogo.</p>
            </div>
            <a
              routerLink="/login"
              class="inline-block py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Voltar ao login
            </a>
          </div>
        }

        @if (state() === 'error') {
          <div class="space-y-6">
            <div class="mx-auto h-16 w-16 bg-red-900/50 rounded-full flex items-center justify-center">
              <svg class="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h1 class="text-2xl font-bold text-white mb-2">Token inválido ou expirado</h1>
              <p class="text-gray-400 mb-6">{{ errorMessage() }}</p>
            </div>
            <div class="space-y-3">
              <button
                (click)="resendVerification()"
                [disabled]="isResending()"
                class="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
              >
                @if (isResending()) {
                  <span class="flex items-center justify-center gap-2">
                    <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Reenviando...
                  </span>
                } @else {
                  Reenviar e-mail de verificação
                }
              </button>
              <a
                routerLink="/login"
                class="block text-sm text-blue-400 hover:text-blue-300"
              >
                Voltar ao login
              </a>
            </div>
            
            @if (resendError()) {
              <div class="mt-4 p-3 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm">
                {{ resendError() }}
              </div>
            }
            
            @if (resendSuccess()) {
              <div class="mt-4 p-3 bg-green-900/50 border border-green-700 text-green-200 rounded-lg text-sm">
                Novo e-mail de verificação enviado! Verifique sua caixa de entrada.
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class VerifyEmailComponent implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  state = signal<'loading' | 'success' | 'error'>('loading');
  errorMessage = signal<string>('');
  isResending = signal<boolean>(false);
  resendError = signal<string | null>(null);
  resendSuccess = signal<boolean>(false);

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      const token = params['token'];
      if (token) {
        this.verifyEmail(token);
      } else {
        this.state.set('error');
        this.errorMessage.set('Token de verificação não fornecido na URL.');
      }
    });
  }

  private verifyEmail(token: string): void {
    this.state.set('loading');
    this.authStore.verifyEmail(token).subscribe({
      next: (response) => {
        if (response.success) {
          this.state.set('success');
        } else {
          this.state.set('error');
          this.errorMessage.set(response.message || 'Falha na verificação.');
        }
      },
      error: (err) => {
        this.state.set('error');
        const message = err.error?.message || 'Token inválido ou expirado.';
        this.errorMessage.set(message);
      },
    });
  }

  resendVerification(): void {
    this.isResending.set(true);
    this.resendError.set(null);
    this.resendSuccess.set(false);

    this.authStore.resendVerificationEmail().subscribe({
      next: (response) => {
        this.isResending.set(false);
        if (response.success) {
          this.resendSuccess.set(true);
        } else {
          this.resendError.set(response.message || 'Falha ao reenviar e-mail.');
        }
      },
      error: (err) => {
        this.isResending.set(false);
        this.resendError.set(err.error?.message || 'Erro ao reenviar e-mail. Tente novamente.');
      },
    });
  }
}