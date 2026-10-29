import { Injectable, signal } from '@angular/core';

type SoundName =
  | 'arrow_hit_1' | 'bash' | 'dagger_hit_1' | 'enemy_hit_1' | 'enemy_hit_2'
  | 'eGem' | 'eat' | 'fatherMarcelus' | 'fire_hit_1' | 'fire_hit_2'
  | 'greatsword_hit_1' | 'hand_hit_1' | 'levelUp' | 'light_hit_1'
  | 'npcDialogue' | 'poisonApply' | 'poisonDamage' | 'questAccepted'
  | 'questCompleted' | 'refineFail' | 'refineSuccess' | 'rod_hit_1'
  | 'staff_hit_1' | 'sword_hit_1' | 'potion_drink' | 'flee';

@Injectable({ providedIn: 'root' })
export class GameAudioService {
  private readonly base = '/assets/sounds/';
  readonly volume = signal(0.7);
  readonly muted = signal(false);
  private readonly effects = new Map<SoundName, string>();
  private music: HTMLAudioElement | null = null;
  private musicRegion = '';
  private musicTracks: string[] = [];
  private musicTrackIndex = -1;
  private musicGeneration = 0;
  private musicFadeFrame = 0;
  private musicFadeResolve: (() => void) | null = null;
  private musicRetryBound = false;
  private lastEnemyHit: SoundName = 'enemy_hit_2';
  private started = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastBattleId = '';
  private lastBattleTick = -1;
  private lastBattleEventIndex = -1;
  private seenResolvedId = '';
  private previousLevel: number | null = null;

  play(name: SoundName): void {
    const audio = new Audio(this.base + this.fileName(name));
    audio.preload = 'auto';
    audio.volume = this.muted() ? 0 : this.volume();
    if (this.muted()) return;
    void audio.play().catch(() => {});
  }

  private fileName(name: SoundName): string {
    const files: Record<SoundName, string> = {
      arrow_hit_1: 'arrow_hit_1.wav', bash: 'bash.wav', dagger_hit_1: 'dagger_hit_1.wav',
      enemy_hit_1: 'enemy_hit_1.wav', enemy_hit_2: 'enemy_hit_2.wav', eGem: 'eGem.wav',
      eat: 'eat.mp3', fatherMarcelus: 'fatherMarcelus.mp3', fire_hit_1: 'fire_hit_1.wav',
      fire_hit_2: 'fire_hit_2.wav', greatsword_hit_1: 'greatsword_hit_1.wav',
      hand_hit_1: 'hand_hit_1.wav', levelUp: 'levelUp.mp3', light_hit_1: 'light_hit_1.wav',
      npcDialogue: 'npcDialogue.mp3', poisonApply: 'poisonApply.mp3',
      poisonDamage: 'poisonDamage.mp3', questAccepted: 'questAccepted.mp3',
      questCompleted: 'questCompleted.mp3', refineFail: 'refineFail.mp3',
      refineSuccess: 'refineSuccess.mp3', rod_hit_1: 'rod_hit_1.wav',
      staff_hit_1: 'staff_hit_1.wav', sword_hit_1: 'sword_hit_1.wav',
      potion_drink: 'potion_drink.mp3', flee: 'flee.mp3',
    };
    return files[name];
  }

  setVolume(value: number): void {
    const next = Math.max(0, Math.min(1, Number(value)));
    this.volume.set(next);
    this.muted.set(next === 0);
    if (this.music) this.music.volume = next;
  }

  toggleMute(): void {
    if (this.muted()) {
      const restored = this.volume() > 0 ? this.volume() : 0.38;
      this.volume.set(restored);
      this.muted.set(false);
      if (this.music) this.music.volume = restored;
    } else {
      this.muted.set(true);
      if (this.music) this.music.volume = 0;
    }
  }

  start(characterStore: any, battleStore: any, inventoryStore: any): void {
    if (this.started) return;
    this.started = true;
    void this.stopMusic(650);
    this.previousLevel = characterStore.character()?.level ?? null;
    this.timer = setInterval(() => {
      const character = characterStore.character();
      if (!character) return;
      this.updateMusic(String(character.currentMapId ?? ''));
      const level = Number(character.level ?? 0);
      if (this.previousLevel !== null && level > this.previousLevel) this.play('levelUp');
      this.previousLevel = level;
      this.updateBattleAudio(battleStore);
      this.updateResolvedAudio(battleStore);
    }, 100);
  }

  destroy(): void {
    this.started = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.musicRegion = '';
    this.musicTracks = [];
    this.musicTrackIndex = -1;
    void this.stopMusic(300);
  }

  private regionFor(mapId: string): { id: string; tracks: string[] } | null {
    if (mapId.startsWith('map_green_grounds')) return { id: 'green-grounds', tracks: ['green-grounds.mp3', 'green-grounds_2.mp3', 'green-grounds_3.mp3'] };
    if (mapId.startsWith('map_menace_hills')) return { id: 'menace-hills', tracks: ['menace-hills.mp3', 'menace-hills_2.mp3', 'menace-hills_3.mp3'] };
    if (mapId.startsWith('map_sierra_village') || mapId === 'map_town') return { id: 'sierra-village', tracks: ['sierra-village.mp3'] };
    if (mapId.startsWith('map_ipora_beach')) return { id: 'ipora-beach', tracks: ['ipora-beach.mp3'] };
    if (mapId.startsWith('map_kwaioua_taba')) return { id: 'kwaioua-taba', tracks: ['kwaioua-taba.mp3'] };
    if (mapId === 'map_emperial_capital_caelum') return { id: 'caelum', tracks: ['caelum.mp3'] };
    return null;
  }

  private updateMusic(mapId: string): void {
    const region = this.regionFor(mapId);
    const nextRegion = region?.id ?? '';
    if (nextRegion === this.musicRegion) {
      // Recover if a transient map update or interrupted fade left a valid region silent.
      if (nextRegion && this.musicTracks.length && !this.music && !this.musicFadeFrame) this.startNextTrack(this.musicGeneration);
      else if (nextRegion && this.music?.paused && !this.musicFadeFrame) this.tryResumeMusic();
      return;
    }
    this.musicRegion = nextRegion;
    this.musicTracks = region?.tracks ?? [];
    this.musicTrackIndex = -1;
    const generation = ++this.musicGeneration;
    this.cancelMusicFade();
    void this.fadeCurrentMusic(850, generation).then(() => {
      if (generation !== this.musicGeneration || !this.musicTracks.length) return;
      this.startNextTrack(generation);
    });
  }

  private startNextTrack(generation: number): void {
    if (generation !== this.musicGeneration || !this.musicTracks.length) return;
    this.musicTrackIndex = (this.musicTrackIndex + 1) % this.musicTracks.length;
    const track = this.musicTracks[this.musicTrackIndex];
    const audio = new Audio(this.base + track);
    this.music = audio;
    audio.loop = false;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.addEventListener('ended', () => {
      if (this.music === audio && generation === this.musicGeneration) this.startNextTrack(generation);
    });
    void audio.play().then(() => this.fadeVolume(audio, 0, this.muted() ? 0 : this.volume(), 900, generation)).catch(() => this.bindMusicRetry());
  }

  private bindMusicRetry(): void {
    if (this.musicRetryBound) return;
    this.musicRetryBound = true;
    const retry = () => {
      this.musicRetryBound = false;
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('keydown', retry, true);
      this.tryResumeMusic();
    };
    document.addEventListener('pointerdown', retry, { once: true, capture: true });
    document.addEventListener('keydown', retry, { once: true, capture: true });
  }

  private tryResumeMusic(): void {
    const audio = this.music;
    const generation = this.musicGeneration;
    if (!this.musicRegion || !audio || !audio.paused) return;
    void audio.play().then(() => this.fadeVolume(audio, audio.volume, this.muted() ? 0 : this.volume(), 900, generation)).catch(() => this.bindMusicRetry());
  }

  private async fadeCurrentMusic(duration: number, generation: number): Promise<void> {
    const audio = this.music;
    if (!audio) return;
    const initial = audio.volume;
    await this.fadeVolume(audio, initial, 0, duration, generation);
    if (generation !== this.musicGeneration) return;
    audio.pause();
    audio.currentTime = 0;
    if (this.music === audio) this.music = null;
  }

  private cancelMusicFade(): void {
    if (this.musicFadeFrame) cancelAnimationFrame(this.musicFadeFrame);
    this.musicFadeFrame = 0;
    const resolve = this.musicFadeResolve;
    this.musicFadeResolve = null;
    resolve?.();
  }

  private fadeVolume(audio: HTMLAudioElement, from: number, to: number, duration: number, generation: number): Promise<void> {
    this.cancelMusicFade();
    const start = performance.now();
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.musicFadeResolve === finish) this.musicFadeResolve = null;
        if (this.musicFadeFrame) cancelAnimationFrame(this.musicFadeFrame);
        this.musicFadeFrame = 0;
        resolve();
      };
      this.musicFadeResolve = finish;
      const tick = (now: number) => {
        if (generation !== this.musicGeneration || audio !== this.music) { finish(); return; }
        const p = Math.min(1, (now - start) / Math.max(1, duration));
        audio.volume = from + (to - from) * p;
        if (p < 1) this.musicFadeFrame = requestAnimationFrame(tick);
        else finish();
      };
      this.musicFadeFrame = requestAnimationFrame(tick);
    });
  }

  private async stopMusic(duration: number): Promise<void> {
    ++this.musicGeneration;
    this.cancelMusicFade();
    const audio = this.music;
    if (!audio) return;
    const initial = audio.volume;
    const start = performance.now();
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / Math.max(1, duration));
        audio.volume = initial * (1 - p);
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    audio.pause();
    audio.currentTime = 0;
    if (this.music === audio) this.music = null;
  }

  private updateBattleAudio(battleStore: any): void {
    const entry = battleStore.active?.();
    if (!entry?.id || !entry.startAt || !entry.log) { this.lastBattleId = ''; this.lastBattleTick = -1; this.lastBattleEventIndex = -1; return; }
    const now = Date.now();
    const startAt = Date.parse(entry.startAt);
    if (!Number.isFinite(startAt) || now < startAt) return;
    const elapsedTick = Math.floor((now - startAt) / 1000);
    const events: any[] = Array.isArray(entry.log?.events) ? entry.log.events : [];
    if (entry.id !== this.lastBattleId) {
      this.lastBattleId = entry.id;
      this.lastBattleTick = elapsedTick;
      this.lastBattleEventIndex = events.reduce((last, event, index) => Number(event?.tick ?? 0) < elapsedTick ? index : last, -1);
    }
    for (let i = this.lastBattleEventIndex + 1; i < events.length; i++) {
      const event = events[i];
      const tick = Number(event?.tick ?? 0);
      if (tick > elapsedTick) break;
      if (tick < this.lastBattleTick) { this.lastBattleEventIndex = i; continue; }
      this.playBattleEvent(event, entry);
      this.lastBattleEventIndex = i;
    }
    this.lastBattleTick = elapsedTick;
  }

  private playBattleEvent(event: any, entry: any): void {
    const actor = String(event?.actor ?? '');
    const action = String(event?.action ?? '');
    const skill = String(event?.skillId ?? event?.sourceSkillId ?? '').toLowerCase();
    const status = String(event?.status ?? event?.statusApplied ?? '').toLowerCase();
    const itemId = String(event?.itemId ?? '').toLowerCase();
    if ((action === 'status_applied' || action === 'status_stack_applied' || action === 'freeze_applied') && status === 'poison') {
      this.play('poisonApply'); return;
    }
    if (action === 'status_damage' && (status === 'poison' || skill.includes('poison'))) { this.play('poisonDamage'); return; }
    if (actor === 'character' && action === 'use_item') {
      if (itemId.startsWith('food_')) { this.play('eat'); return; }
      if (itemId.includes('potion') || itemId.startsWith('elixir_')) { this.play('potion_drink'); return; }
    }
    if ((skill.includes('bash') || skill.includes('ground_slam')) && Number(event?.damage ?? 0) > 0) { this.play('bash'); return; }
    if (actor === 'monster' && event?.target === 'character' && action !== 'status_damage' && event?.hit !== false && Number(event?.damage ?? 0) > 0) {
      this.lastEnemyHit = this.lastEnemyHit === 'enemy_hit_1' ? 'enemy_hit_2' : 'enemy_hit_1';
      this.play(this.lastEnemyHit); return;
    }
    if (actor !== 'character' || event?.target !== 'monster') return;
    if (action === 'use_skill') {
      if (skill.includes('fire_ball') || skill === 'fireball') { this.play('fire_hit_1'); return; }
      if (skill.includes('fire_blast') || skill === 'fireblast') { this.play('fire_hit_2'); return; }
      if (skill.includes('light_wisp') || skill === 'wisp_flow') { this.play('light_hit_1'); return; }
      if (skill.includes('bash') || skill.includes('ground_slam')) { this.play('bash'); return; }
      if (skill.includes('poison')) { this.play('poisonApply'); return; }
    }
    if (action !== 'attack' && action !== 'use_skill') return;
    if (event?.hit === false || Number(event?.damage ?? 0) <= 0) return;
    const header = entry.log?.header?.characterSnapshot ?? {};
    const types: string[] = header.equippedWeaponTypes ?? [];
    const weapon = String(types.find((type: string) => !['shield', 'rune'].includes(type)) ?? '').toLowerCase();
    if (weapon === 'greatsword') this.play('greatsword_hit_1');
    else if (weapon === 'dagger') this.play('dagger_hit_1');
    else if (weapon === 'bow' || event?.damageType === 'ranged') this.play('arrow_hit_1');
    else if (weapon === 'staff') this.play('staff_hit_1');
    else if (weapon === 'rod') this.play('rod_hit_1');
    else if (weapon === 'sword') this.play('sword_hit_1');
    else this.play('hand_hit_1');
  }

  private updateResolvedAudio(battleStore: any): void {
    const resolved = battleStore.lastResolved?.();
    if (!resolved?.entryId || resolved.entryId === this.seenResolvedId) return;
    this.seenResolvedId = resolved.entryId;
    if (resolved.cancellationReason === 'flee') this.play('flee');
    for (const drop of resolved.drops ?? []) {
      const itemId = String((drop as any)?.itemId ?? '');
      if (itemId === 'bliss_stone' || itemId === 'divine_shard' || itemId === 'mat_bliss_stone' || itemId === 'mat_divine_shard') this.play('eGem');
    }
    for (const consumed of resolved.itemsConsumed ?? []) {
      const itemId = String((consumed as any)?.itemId ?? '');
      if (itemId.startsWith('food_')) this.play('eat');
      else if (itemId.startsWith('potion_') || itemId.startsWith('elixir_') || itemId.includes('potion')) this.play('potion_drink');
    }
  }
}
