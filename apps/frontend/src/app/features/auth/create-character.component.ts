import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';

@Component({
  selector: 'app-create-character',
  standalone: true,
  imports: [CommonModule, FormsModule, LoginMusicControlComponent],
  template: `
    <div class="auth-screen"><app-login-music-control />
      <div class="auth-panel ml-5">

        <h2 class="text-2xl font-bold text-gray-200 mb-6">Crie seu personagem</h2>

        @if (serverError()) {
          <div class="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm">
            {{ serverError() }}
          </div>
        }

        <form (ngSubmit)="onSubmit()" #createForm="ngForm" class="space-y-1">
          <div>
            <label for="name" class="block text-sm font-medium text-gray-300">Nome do Personagem</label>
            <input
              type="text"
              id="name"
              name="name"
              [(ngModel)]="form.name"
              required
              minlength="3"
              maxlength="16"
              pattern="^[a-zA-Z0-9]{3,16}$"
              #nameInput="ngModel"
              class="auth-input"
              placeholder="3-16 caracteres alfanuméricos"
            />
            @if (nameInput.invalid && (nameInput.dirty || nameInput.touched)) {
              <p class="mt-1 text-sm text-red-400">
                @if (nameInput.errors?.['required']) {
                  Nome é obrigatório
                } @else if (nameInput.errors?.['minlength'] || nameInput.errors?.['maxlength']) {
                  Nome deve ter entre 3 e 16 caracteres
                } @else if (nameInput.errors?.['pattern']) {
                  Nome deve conter apenas letras e números
                }
              </p>
            }
          </div>

          <button
            type="submit"
            [disabled]="isLoading() || createForm.invalid"
            class="auth-button"
          >
            @if (isLoading()) {
              <span class="flex items-center justify-center gap-2">
                <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Criando personagem...
              </span>
            } @else {
              Criar Personagem
            }
          </button>
        </form>
      </div>
    </div>
  `,
})
export class CreateCharacterComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  form = {
    name: '',
  };

  isLoading = this.authStore.isLoading;
  serverError = signal<string | null>(null);

  onSubmit(): void {
    const { name } = this.form;
    this.serverError.set(null);
    this.authStore.createCharacter(name).subscribe({
      next: () => {
        this.router.navigate(['/play']);
      },
      error: (err) => {
        if (err.status === 409) {
          this.serverError.set('Nome já em uso');
        } else {
          this.serverError.set(err.error?.message || 'Falha ao criar personagem');
        }
      },
    });
  }
}