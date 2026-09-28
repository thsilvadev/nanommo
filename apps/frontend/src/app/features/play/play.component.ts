import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthStore } from '../../core/auth.store';
import { ApiService } from '../../core/api.service';

interface MapInfo {
  id: string;
  name: string;
  unlockLevel: number;
  monsterLevels: string;
  theme: string;
}

interface MapEnterResponse {
  success: boolean;
  currentMapId: string;
  character: string;
}

@Component({
  selector: 'app-play',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-gray-900 px-4 py-8">
      <div class="max-w-4xl mx-auto">
        <header class="flex items-center justify-between mb-8">
          <h1 class="text-4xl font-bold text-white">NanoMMO</h1>
          <div class="flex items-center gap-4 text-sm text-gray-400">
            <span>Logado como: </span>
            <strong class="text-white">{{ username() }}</strong>
            <button
              (click)="onLogout()"
              class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
            >
              Sair
            </button>
          </div>
        </header>

        @if (showEmailVerificationBanner()) {
          <div class="mb-6 p-4 bg-yellow-900/50 border border-yellow-700 rounded-lg">
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <svg class="h-5 w-5 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p class="text-yellow-200 font-medium">Confirme seu e-mail para jogar</p>
                  <p class="text-yellow-300 text-sm">Você precisa verificar seu endereço de e-mail antes de entrar em um mapa.</p>
                </div>
              </div>
              <button
                (click)="resendVerificationEmail()"
                [disabled]="isResendingVerification()"
                class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-900/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                @if (isResendingVerification()) {
                  <span class="flex items-center gap-2">
                    <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Enviando...
                  </span>
                } @else {
                  Reenviar e-mail
                }
              </button>
            </div>
            @if (resendVerificationError()) {
              <p class="mt-2 text-sm text-red-300">{{ resendVerificationError() }}</p>
            }
            @if (resendVerificationSuccess()) {
              <p class="mt-2 text-sm text-green-300">Novo e-mail de verificação enviado! Verifique sua caixa de entrada.</p>
            }
          </div>
        }

        <section class="mb-8">
          <h2 class="text-2xl font-bold text-white mb-4">Selecionar Mapa</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            @for (map of maps(); track map.id) {
              <div class="bg-gray-800 border border-gray-700 rounded-xl p-6 hover:border-blue-500 transition-colors">
                <h3 class="text-xl font-bold text-white mb-2">{{ map.name }}</h3>
                <p class="text-gray-400 text-sm mb-2">{{ map.theme }}</p>
                <div class="text-sm text-gray-500 mb-4">
                  <span>Nível recomendado: </span><strong class="text-gray-300">{{ map.unlockLevel }}+</strong>
                </div>
                <div class="text-sm text-gray-500 mb-4">
                  <span>Monstros: </span><strong class="text-gray-300">{{ map.monsterLevels }}</strong>
                </div>
                <button
                  (click)="enterMap(map.id)"
                  [disabled]="isEnteringMap() === map.id"
                  class="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                >
                  @if (isEnteringMap() === map.id) {
                    <span class="flex items-center justify-center gap-2">
                      <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      Entrando...
                    </span>
                  } @else {
                    Entrar no mapa
                  }
                </button>
              </div>
            }
          </div>
        </section>

        @if (currentMap()) {
          <section>
            <div class="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-2xl font-bold text-white">Grind Ativo</h2>
                <span class="px-3 py-1 bg-green-900/50 text-green-300 text-sm font-medium rounded-full">
                  Em {{ currentMap() }}
                </span>
              </div>
              <p class="text-gray-400">Seu personagem está grindando automaticamente neste mapa.</p>
            </div>
          </section>
        }
      </div>
    </div>
  `,
})
export class PlayComponent {
  private readonly authStore = inject(AuthStore);
  private readonly api = inject(ApiService);

  username = computed(() => this.authStore.userPayload()?.username || '');

  maps = signal<MapInfo[]>([
    { id: 'map_green_grounds', name: 'Green Grounds', unlockLevel: 1, monsterLevels: '1-6', theme: 'Planícies gramadas, primeiros passos' },
    { id: 'map_menace', name: 'Menace', unlockLevel: 8, monsterLevels: '7-13', theme: 'Deserto árido, invasores e feras da areia' },
    { id: 'map_ruins', name: 'Ruins', unlockLevel: 15, monsterLevels: '14-20', theme: 'Cidade antiga abandonada' },
  ]);

  currentMap = signal<string | null>(null);
  isEnteringMap = signal<string | null>(null);
  showEmailVerificationBanner = signal(false);
  isResendingVerification = signal(false);
  resendVerificationError = signal<string | null>(null);
  resendVerificationSuccess = signal(false);

  async enterMap(mapId: string): Promise<void> {
    this.isEnteringMap.set(mapId);
    this.resendVerificationError.set(null);
    this.resendVerificationSuccess.set(false);

    try {
      const response = await this.api.post<MapEnterResponse>(`/maps/${mapId}/enter`, {}).toPromise();
      if (response?.success) {
        this.currentMap.set(mapId);
        this.showEmailVerificationBanner.set(false);
      }
    } catch (err: unknown) {
      const error = err as { error?: { message?: string }; status?: number };
      if (error.error?.message === 'EMAIL_NOT_VERIFIED' || error.status === 400) {
        this.showEmailVerificationBanner.set(true);
      }
    } finally {
      this.isEnteringMap.set(null);
    }
  }

  resendVerificationEmail(): void {
    this.isResendingVerification.set(true);
    this.resendVerificationError.set(null);
    this.resendVerificationSuccess.set(false);

    this.authStore.resendVerificationEmail().subscribe({
      next: (response) => {
        this.isResendingVerification.set(false);
        if (response.success) {
          this.resendVerificationSuccess.set(true);
        } else {
          this.resendVerificationError.set(response.message || 'Falha ao reenviar e-mail.');
        }
      },
      error: (err) => {
        this.isResendingVerification.set(false);
        this.resendVerificationError.set(err.error?.message || 'Erro ao reenviar e-mail. Tente novamente.');
      },
    });
  }

  onLogout(): void {
    this.authStore.logout();
  }
}