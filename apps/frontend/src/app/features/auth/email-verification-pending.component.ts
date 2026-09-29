import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-email-verification-pending',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div class="w-full max-w-md bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700 text-center">
        <div class="mx-auto h-16 w-16 bg-blue-900/50 rounded-full flex items-center justify-center text-3xl">✉</div>
        <h1 class="text-2xl font-bold text-white mt-5 mb-3">Confirme seu e-mail</h1>
        <p class="text-gray-300">Sua conta foi criada, mas você precisa confirmar o endereço de e-mail antes de entrar no jogo.</p>
        <p class="text-gray-400 text-sm mt-3" *ngIf="email()">Enviamos a mensagem para <strong class="text-gray-200">{{ email() }}</strong>.</p>
        <p class="text-gray-500 text-sm mt-4">Abra o e-mail recebido e clique no link de confirmação. Depois disso, volte para o login.</p>
        <a routerLink="/login" class="inline-block mt-7 py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">Voltar ao login</a>
      </div>
    </div>
  `,
})
export class EmailVerificationPendingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  readonly email = signal<string>('');

  ngOnInit(): void {
    this.email.set(this.route.snapshot.queryParamMap.get('email') ?? '');
  }
}