import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthStore } from '../../core/auth.store';

@Component({
  selector: 'app-play',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div class="text-center">
        <h1 class="text-4xl font-bold text-white mb-6">NanoMMO</h1>
        <div class="bg-gray-800 border border-gray-700 rounded-xl p-12 max-w-md mx-auto">
          <p class="text-xl text-gray-300 mb-8">Em manutenção — volte em breve</p>
          <div class="flex items-center justify-center gap-4 text-sm text-gray-500 mb-8">
            <span>Logado como: </span>
            <strong class="text-white">{{ username() }}</strong>
          </div>
          <button
            (click)="onLogout()"
            class="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  `,
})
export class PlayComponent {
  private readonly authStore = inject(AuthStore);

  username = computed(() => this.authStore.userPayload()?.username || '');

  onLogout(): void {
    this.authStore.logout();
  }
}

import { inject, computed } from '@angular/core';