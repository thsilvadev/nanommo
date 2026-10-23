import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';

@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [CommonModule, LoginMusicControlComponent],
  template: `
    <div class="auth-screen"><app-login-music-control />
      <main class="auth-panel auth-center ml-5" role="alert" aria-live="polite">
        <div class="mx-auto h-16 w-16 rounded-full bg-red-900/50 flex items-center justify-center text-3xl text-red-300" aria-hidden="true">!</div>
        <h1 class="text-2xl font-bold text-white mt-5 mb-3">{{ title() }}</h1>
        <p class="text-gray-300">{{ message() }}</p>
        <p class="text-gray-400 text-sm mt-4">Desculpe pelo transtorno. Isso não significa que seu personagem foi perdido: não conseguimos confirmar os dados agora e, por segurança, não vamos encaminhar você para criar outro personagem.</p>
        <p class="text-gray-500 text-sm mt-3">Tente novamente. Se o problema continuar, aguarde alguns minutos e tente mais tarde.</p>
        <button type="button" (click)="retry()" [disabled]="retrying()" class="inline-block mt-7 py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors">
          {{ retrying() ? 'Tentando novamente…' : 'Tentar novamente' }}
        </button>
      </main>
    </div>
  `,
})
export class ErrorPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly title = signal('Ocorreu um problema');
  readonly message = signal('Não foi possível concluir sua solicitação.');
  readonly retrying = signal(false);
  private returnUrl = '/play';

  ngOnInit(): void {
    const reason = this.route.snapshot.queryParamMap.get('reason');
    if (reason === 'character-load') {
      this.title.set('Não conseguimos carregar seu personagem');
      this.message.set('Pode ter ocorrido uma falha temporária de comunicação com o servidor ao buscar os dados do jogo.');
    }

    const requestedReturnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    // Only accept an app-local path; never navigate to an external URL from query data.
    if (requestedReturnUrl?.startsWith('/') && !requestedReturnUrl.startsWith('//')) {
      this.returnUrl = requestedReturnUrl;
    }
  }

  async retry(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      await this.router.navigateByUrl(this.returnUrl, { replaceUrl: true });
    } finally {
      this.retrying.set(false);
    }
  }
}
