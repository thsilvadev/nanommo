import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth.store';

@Component({
  selector: 'app-google-callback',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="auth-screen"><div class="auth-panel auth-center ml-5">
      @if (error) {
        <h2>Não foi possível entrar com Google</h2>
        <p class="mt-4">{{ error }}</p>
        <a class="auth-link" routerLink="/login">Voltar para o login</a>
      } @else {
        <p>Conectando sua conta Google...</p>
      }
    </div></div>
  `,
})
export class GoogleCallbackComponent {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  error: string | null = null;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (error) {
      this.error = error;
      return;
    }
    if (!code) {
      this.error = 'Código de autenticação ausente.';
      return;
    }
    this.auth.redeemGoogleHandoff(code).subscribe({
      next: () => this.router.navigate([this.auth.routeAfterLogin()]),
      error: (err) => {
        this.error = err.error?.message || 'O login com Google falhou. Tente novamente.';
      },
    });
  }
}
