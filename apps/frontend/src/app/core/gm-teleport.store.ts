import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

/** Presentation of the server-owned GM toggle. Every teleport is authorized again by the API. */
@Injectable({ providedIn: 'root' })
export class GmTeleportStore {
  readonly enabled = signal(false);
  private characterId: string | undefined;
  private requestSequence = 0;

  constructor(private readonly api: ApiService) {}

  forCharacter(characterId: string | undefined): void {
    if (characterId !== this.characterId) void this.refreshFor(characterId);
  }

  async refreshFor(characterId: string | undefined): Promise<void> {
    if (characterId !== this.characterId) this.enabled.set(false);
    this.characterId = characterId;
    const sequence = ++this.requestSequence;
    if (!characterId) { this.enabled.set(false); return; }
    try {
      const status = await firstValueFrom(this.api.get<{ enabled: boolean }>('/maps/gm-teleport-mode'));
      if (sequence === this.requestSequence) this.enabled.set(status?.enabled === true);
    } catch {
      if (sequence === this.requestSequence) this.enabled.set(false);
    }
  }
}
