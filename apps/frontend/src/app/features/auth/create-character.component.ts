import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  defaultAppearance, heightAttributeAdjustment, heightBandFromCm, HEIGHT_CM_MAX, HEIGHT_CM_MIN,
  type AppearanceCatalog, type AppearanceInput, type AppearanceOption, type AppearanceTrait,
  type CharacterAppearance, type HandWeaponType, type Sex,
} from '@nanommo/shared';
import { AuthStore } from '../../core/auth.store';
import { CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { CharacterViewerComponent, loadAppearanceCatalog } from '../../shared/character-viewer/character-viewer.component';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';

/** Traits whose option lists differ by sex: switching sex resets them to the first option. */
const SEX_DEPENDENT: readonly AppearanceTrait[] = ['hair', 'face', 'nose', 'mouth', 'mouthDetails', 'chest', 'facialHair'];
const NAME_PATTERN = /^[a-zA-Z0-9]{3,16}$/;
const DEFAULT_HEIGHT: Record<Sex, number> = { male: 178, female: 168 };

interface ControlGroup { title: string; traits: AppearanceTrait[] }

/**
 * Character creator. Two modes:
 * - new: name, dominant hand and appearance; the preview holds the starter knife.
 * - update: a character created before the 3D creator. Name and hand are shown
 *   locked; only the appearance is saved, once.
 */
@Component({
  selector: 'app-create-character',
  standalone: true,
  imports: [CharacterViewerComponent, LoginMusicControlComponent],
  templateUrl: './create-character.component.html',
  styleUrl: './create-character.component.css',
})
export class CreateCharacterComponent {
  private readonly authStore = inject(AuthStore);
  private readonly characterStore = inject(CharacterStore);
  private readonly inventory = inject(InventoryStore);
  private readonly items = inject(CatalogService);
  private readonly router = inject(Router);
  readonly locale = inject(LocaleService);
  private readonly viewer = viewChild(CharacterViewerComponent);

  readonly heightMin = HEIGHT_CM_MIN;
  readonly heightMax = HEIGHT_CM_MAX;
  readonly existing = this.characterStore.character();
  readonly mode = signal<'new' | 'update'>(this.existing ? 'update' : 'new');

  readonly form = { name: this.existing?.name ?? '', dominantHand: (this.existing?.dominantHand ?? 'right') as 'right' | 'left' };
  readonly sex = signal<Sex>('male');
  readonly heightCm = signal(DEFAULT_HEIGHT.male);
  readonly appearance = signal<CharacterAppearance>(defaultAppearance());
  readonly dominantHand = signal<'right' | 'left'>(this.form.dominantHand);

  readonly catalog = signal<AppearanceCatalog | null>(null);
  readonly equipped = signal<{ main: HandWeaponType | null; off: HandWeaponType | null }>({ main: null, off: null });
  readonly previewFailed = signal(false);
  readonly confirming = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly hands = computed(() => (this.mode() === 'new' ? { main: 'dagger' as HandWeaponType, off: null } : this.equipped()));
  readonly band = computed(() => heightBandFromCm(this.heightCm()));
  readonly adjustment = computed(() => heightAttributeAdjustment(this.band()));
  readonly adjustmentLabel = computed(() => {
    const sign = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
    const { str, luk } = this.adjustment();
    return `${this.locale.t('STR')} ${sign(str)} · ${this.locale.t('LUK')} ${sign(luk)}`;
  });
  readonly heightLabel = computed(() => {
    const metres = (this.heightCm() / 100).toFixed(2);
    return `${this.locale.locale() === 'pt-BR' ? metres.replace('.', ',') : metres} m`;
  });

  readonly groups = computed<ControlGroup[]>(() => [
    { title: 'Body', traits: ['skin', 'chest'] },
    { title: 'Face', traits: ['face', 'nose', 'mouth', 'mouthDetails', 'facialHair'] },
    { title: 'Hair', traits: ['hair', 'hairColor'] },
    { title: 'Details', traits: ['piercing', 'tattoo'] },
  ]);

  /** Resolves once the catalogue (and, for an existing character, its equipment) is loaded. */
  readonly ready: Promise<void> = this.init();

  private async init(): Promise<void> {
    try {
      this.catalog.set(await loadAppearanceCatalog());
    } catch {
      this.error.set(this.locale.t('Could not load the character options. Reload the page to try again.'));
    }
    if (this.mode() === 'update') {
      try {
        await Promise.all([this.items.load(), this.inventory.load()]);
        const typeIn = (slot: string): HandWeaponType | null => {
          const row = this.inventory.equipment().find((item) => item.slot === slot);
          return (row ? (this.items.item(row.itemId) as { weaponType?: HandWeaponType } | undefined)?.weaponType : null) ?? null;
        };
        this.equipped.set({ main: typeIn('mainHand'), off: typeIn('offHand') });
      } catch {
        // The preview just shows empty hands; saving does not depend on it.
      }
    }
  }

  options(trait: AppearanceTrait): AppearanceOption[] {
    return this.catalog()?.[this.sex()][trait] ?? [];
  }

  selected(trait: AppearanceTrait): AppearanceOption | undefined {
    return this.options(trait)[this.appearance()[trait]];
  }

  optionName(option: AppearanceOption | undefined): string {
    return option ? this.locale.localized(option, 'name', option.id) : '';
  }

  traitLabel(trait: AppearanceTrait): string {
    const labels: Record<AppearanceTrait, string> = {
      hair: 'Hairstyle', hairColor: 'Hair colour', skin: 'Skin tone', face: 'Face shape', nose: 'Nose',
      mouth: 'Mouth', mouthDetails: 'Mouth details', chest: 'Chest',
      facialHair: this.sex() === 'female' ? 'Eyebrows' : 'Facial hair', piercing: 'Piercing', tattoo: 'Tattoo',
    };
    return this.locale.t(labels[trait]);
  }

  isSwatch(trait: AppearanceTrait): boolean {
    return trait === 'skin' || trait === 'hairColor';
  }

  setSex(sex: Sex): void {
    if (sex === this.sex()) return;
    this.sex.set(sex);
    const next = { ...this.appearance() };
    for (const trait of SEX_DEPENDENT) next[trait] = 0;
    this.appearance.set(next);
  }

  setHeight(cm: number): void {
    const value = Math.round(Number(cm));
    if (Number.isFinite(value)) this.heightCm.set(Math.min(HEIGHT_CM_MAX, Math.max(HEIGHT_CM_MIN, value)));
  }

  pick(trait: AppearanceTrait, index: number): void {
    this.appearance.update((current) => ({ ...current, [trait]: index }));
  }

  step(trait: AppearanceTrait, delta: number): void {
    const count = this.options(trait).length;
    if (!count) return;
    this.pick(trait, (this.appearance()[trait] + delta + count) % count);
  }

  setName(value: string): void {
    this.form.name = value;
  }

  setHand(hand: 'right' | 'left'): void {
    if (this.mode() === 'update') return;
    this.form.dominantHand = hand;
    this.dominantHand.set(hand);
  }

  nameValid(): boolean {
    return this.mode() === 'update' || NAME_PATTERN.test(this.form.name);
  }

  canConfirm(): boolean {
    return !!this.catalog() && this.nameValid() && !this.submitting();
  }

  retryPreview(): void {
    this.previewFailed.set(false);
    this.viewer()?.retry();
  }

  requestConfirm(): void {
    if (!this.canConfirm()) return;
    this.error.set(null);
    this.confirming.set(true);
  }

  cancelConfirm(): void {
    if (!this.submitting()) this.confirming.set(false);
  }

  async submit(): Promise<void> {
    if (!this.confirming() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    const input: AppearanceInput = { sex: this.sex(), heightCm: this.heightCm(), appearance: { ...this.appearance() } };
    try {
      if (this.mode() === 'update') {
        await this.characterStore.setAppearance(input);
      } else {
        await firstValueFrom(this.authStore.createCharacter(this.form.name, this.form.dominantHand, input));
      }
      await this.router.navigate(['/play']);
    } catch (err: any) {
      if (this.mode() === 'update' && err?.status === 409) {
        // Already saved (another tab, or a retried request): continue with what the server has.
        await this.characterStore.load();
        await this.router.navigate(['/play']);
        return;
      }
      this.error.set(err?.error?.message === 'PROHIBITED_CHARACTER_NAME'
        ? this.locale.t('This character name is not allowed.')
        : this.mode() === 'new' && err?.status === 409
        ? this.locale.t('Name already in use')
        : err?.error?.message ?? this.locale.t('Could not save the character. Try again.'));
      this.confirming.set(false);
    } finally {
      this.submitting.set(false);
    }
  }
}
