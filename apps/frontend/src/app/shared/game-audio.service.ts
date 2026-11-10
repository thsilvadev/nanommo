import { Injectable, signal } from '@angular/core';

type SoundName =
  | 'arrow_hit_1' | 'bash' | 'dagger_hit_1' | 'enemy_hit_1' | 'enemy_hit_2'
  | 'eGem' | 'eat' | 'fatherMarcelus' | 'fire_hit_1' | 'fire_hit_2'
  | 'greatsword_hit_1' | 'hand_hit_1' | 'levelUp' | 'light_hit_1'
  | 'npcDialogue' | 'poisonApply' | 'poisonDamage' | 'questAccepted'
  | 'questCompleted' | 'respec' | 'refineFail' | 'refineSuccess' | 'rod_hit_1'
  | 'staff_hit_1' | 'sword_hit_1' | 'potion_drink' | 'flee' | 'foodCooked' | 'gather'
  | 'boughtItemFromNpc' | 'soldItemToNpc' | 'putInStorage' | 'takeFromStorage' | 'postItemOnMarket'
  | 'use_fairy_in_a_bottle' | 'use_tonic' | 'mailInbox' | 'saveTown';

@Injectable({ providedIn: 'root' })
export class GameAudioService {
  private readonly base = '/assets/sounds/';
  private readonly volumeStorageKey = 'nanommo:game-audio-volume';
  private readonly mutedStorageKey = 'nanommo:game-audio-muted';
  private readonly effectsVolumeStorageKey = 'nanommo:game-audio-effects-volume';
  private readonly musicVolumeStorageKey = 'nanommo:game-audio-music-volume';
  private readonly effectsMutedStorageKey = 'nanommo:game-audio-effects-muted';
  private readonly musicMutedStorageKey = 'nanommo:game-audio-music-muted';
  readonly volume = signal(this.readStoredVolume());
  readonly muted = signal(this.readStoredMuted());
  readonly effectsVolume = signal(this.readStoredNumber(this.effectsVolumeStorageKey, 1));
  readonly musicVolume = signal(this.readStoredNumber(this.musicVolumeStorageKey, 1));
  readonly effectsMuted = signal(this.readStoredBoolean(this.effectsMutedStorageKey));
  readonly musicMuted = signal(this.readStoredBoolean(this.musicMutedStorageKey));
  private readonly effects = new Map<SoundName, string>();
  private music: HTMLAudioElement | null = null;
  private pendingMusic: HTMLAudioElement | null = null;
  private pendingMusicStarting = false;
  private pendingMusicBlocked = false;
  private readonly musicInstances = new Set<HTMLAudioElement>();
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
  private readonly battleItemSoundCounts = new Map<string, Map<string, number>>();

  private readStoredVolume(): number {
    try {
      const stored = localStorage.getItem(this.volumeStorageKey);
      if (stored === null) return 0.7;
      const value = Number(stored);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.7;
    } catch { return 0.7; }
  }

  private readStoredNumber(key: string, fallback: number): number {
    try { const raw = localStorage.getItem(key); if (raw === null) return fallback; const value = Number(raw); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback; } catch { return fallback; }
  }

  private readStoredBoolean(key: string): boolean {
    try { return localStorage.getItem(key) === 'true'; } catch { return false; }
  }

  private readStoredMuted(): boolean {
    try {
      const stored = localStorage.getItem(this.mutedStorageKey);
      if (stored !== null) return stored === 'true';
      return this.volume() === 0;
    } catch { return this.volume() === 0; }
  }

  private persistAudioSettings(): void {
    try {
      localStorage.setItem(this.volumeStorageKey, String(this.volume()));
      localStorage.setItem(this.mutedStorageKey, String(this.muted()));
    } catch { /* Audio still works when browser storage is unavailable. */ }
  }

  play(name: SoundName): void {
    const audio = new Audio(this.base + this.fileName(name));
    audio.preload = 'auto';
    audio.volume = this.muted() || this.effectsMuted() ? 0 : this.volume() * this.effectsVolume();
    if (this.muted() || this.effectsMuted()) return;
    void audio.play().catch(() => {});
  }

  private fileName(name: SoundName): string {
    const files: Record<SoundName, string> = {
      arrow_hit_1: 'arrow_hit_1.wav', bash: 'bash.wav', dagger_hit_1: 'dagger_hit_1.wav',
      enemy_hit_1: 'enemy_hit_1.wav', enemy_hit_2: 'enemy_hit_2.wav', eGem: 'eGem.mp3',
      eat: 'eat.mp3', fatherMarcelus: 'fatherMarcelus.mp3', fire_hit_1: 'fire_hit_1.wav',
      fire_hit_2: 'fire_hit_2.wav', greatsword_hit_1: 'greatsword_hit_1.wav',
      hand_hit_1: 'hand_hit_1.wav', levelUp: 'levelUp.mp3', light_hit_1: 'light_hit_1.wav',
      npcDialogue: 'npcDialogue.mp3', poisonApply: 'poisonApply.mp3',
      poisonDamage: 'poisonDamage.mp3', questAccepted: 'questAccepted.mp3',
      questCompleted: 'questCompleted.mp3', respec: 'respec.mp3', refineFail: 'refineFail.mp3',
      refineSuccess: 'refineSuccess.mp3', rod_hit_1: 'rod_hit_1.wav',
      staff_hit_1: 'staff_hit_1.wav', sword_hit_1: 'sword_hit_1.wav',
      potion_drink: 'potion_drink.mp3', flee: 'flee.mp3',
      foodCooked: 'new_packs/2/foodCooked.mp3', gather: 'new_packs/2/gather.mp3',
      boughtItemFromNpc: 'new_packs/2/boughtItemFromNpc.mp3',
      soldItemToNpc: 'new_packs/2/soldItemToNpc.ogg',
      putInStorage: 'new_packs/2/putInStorage.ogg',
      takeFromStorage: 'new_packs/2/takeFromStorage.ogg',
      postItemOnMarket: 'new_packs/2/postItemOnMarket.ogg',
      use_fairy_in_a_bottle: 'new_packs/3/useFarieInABottle.mp3',
      use_tonic: 'new_packs/3/useTonic.mp3',
      mailInbox: 'new_packs/4/mailInbox.mp3',
      saveTown: 'new_packs/5/save.mp3',
    };
    return files[name];
  }

  setVolume(value: number, channel: 'general' | 'effects' | 'music' = 'general'): void {
    const next = Math.max(0, Math.min(1, Number(value)));
    if (channel === 'effects') {
      this.effectsVolume.set(next); this.effectsMuted.set(next === 0);
      try { localStorage.setItem(this.effectsVolumeStorageKey, String(next)); localStorage.setItem(this.effectsMutedStorageKey, String(this.effectsMuted())); } catch { }
      return;
    }
    if (channel === 'music') {
      this.musicVolume.set(next); this.musicMuted.set(next === 0);
      try { localStorage.setItem(this.musicVolumeStorageKey, String(next)); localStorage.setItem(this.musicMutedStorageKey, String(this.musicMuted())); } catch { }
      this.applyMusicVolume();
      if (!this.musicMuted() && !this.muted() && this.music?.paused) this.tryResumeMusic();
      if (this.pendingMusic && !this.muted() && !this.musicMuted()) { this.pendingMusicBlocked = false; this.tryStartPendingMusic(this.pendingMusic, this.musicGeneration); }
      return;
    }
    this.volume.set(next); this.muted.set(next === 0); this.persistAudioSettings();
    this.applyMusicVolume();
    if (!this.muted() && !this.musicMuted() && this.music?.paused) this.tryResumeMusic();
    if (this.pendingMusic && !this.muted() && !this.musicMuted()) { this.pendingMusicBlocked = false; this.tryStartPendingMusic(this.pendingMusic, this.musicGeneration); }
  }

  toggleMute(channel: 'general' | 'effects' | 'music' = 'general'): void {
    if (channel === 'effects' || channel === 'music') {
      const muted = channel === 'effects' ? this.effectsMuted : this.musicMuted;
      const volume = channel === 'effects' ? this.effectsVolume : this.musicVolume;
      const key = channel === 'effects' ? this.effectsMutedStorageKey : this.musicMutedStorageKey;
      const nextMuted = !muted(); muted.set(nextMuted);
      if (volume() <= 0 && !nextMuted) volume.set(0.38);
      try { localStorage.setItem(key, String(nextMuted)); localStorage.setItem(channel === 'effects' ? this.effectsVolumeStorageKey : this.musicVolumeStorageKey, String(volume())); } catch { }
      if (channel === 'music') {
        this.applyMusicVolume();
        if (!nextMuted && !this.muted() && this.music?.paused) this.tryResumeMusic();
        if (!nextMuted && this.pendingMusic) { this.pendingMusicBlocked = false; this.tryStartPendingMusic(this.pendingMusic, this.musicGeneration); }
      }
      return;
    }
    if (this.muted()) { this.volume.set(this.volume() > 0 ? this.volume() : 0.38); this.muted.set(false); }
    else this.muted.set(true);
    this.persistAudioSettings(); this.applyMusicVolume();
    if (!this.muted() && !this.musicMuted() && this.music?.paused) this.tryResumeMusic();
    if (!this.muted() && !this.musicMuted() && this.pendingMusic) { this.pendingMusicBlocked = false; this.tryStartPendingMusic(this.pendingMusic, this.musicGeneration); }
  }

  private applyMusicVolume(): void {
    const value = this.muted() || this.musicMuted() ? 0 : this.volume() * this.musicVolume();
    if (this.music) this.music.volume = value;
    if (this.pendingMusic && this.pendingMusic !== this.music) this.pendingMusic.volume = 0;
  }

  start(characterStore: any, battleStore: any, inventoryStore: any): void {
    if (this.started) return;
    this.started = true;
    // start() is called before the first map poll. Do not launch a competing
    // asynchronous stop/fade here: updateMusic owns the initial region transition.
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
    if (mapId.startsWith('map_ipora_beach')) return { id: 'ipora-beach', tracks: ['ipora-beach.mp3', 'ipora-beach_2.mp3'] };
    if (mapId.startsWith('map_kwaioua_taba')) return { id: 'kwaioua-taba', tracks: ['kwaioua-taba.mp3'] };
    if (mapId.startsWith('map_caete')) return { id: 'caete', tracks: ['caete.mp3', 'caete_2.mp3', 'caete_3.mp3'] };
    if (mapId.startsWith('map_forest_ruins')) return { id: 'forest-ruins', tracks: ['forest-ruins.mp3', 'forest-ruins_2.mp3', 'forest-ruins_3.mp3', 'forest-ruins_4.mp3'] };
    if (mapId === 'map_gods_bridge') return { id: 'gods-bridge', tracks: ['gods-bridge.mp3'] };
    if (mapId.startsWith('map_kwaioua_forest')) return { id: 'kwaioua-forest', tracks: ['kwaioua-forest.mp3', 'kwaioua-forest_2.mp3', 'kwaioua-forest_3.mp3'] };
    if (mapId === 'map_outpost') return { id: 'outpost', tracks: ['outpost.mp3'] };
    if (mapId.startsWith('map_wastelands')) return { id: 'wastelands', tracks: ['wastelands.mp3', 'wastelands_2.mp3', 'wastelands_3.mp3'] };
    if (mapId === 'map_aramaia_city') return { id: 'aramaia-city', tracks: ['aramaia-city.mp3'] };
    if (mapId === 'map_emperial_capital_caelum') return { id: 'caelum', tracks: ['caelum.mp3'] };
    return null;
  }

  private updateMusic(mapId: string): void {
    const region = this.regionFor(mapId);
    const nextRegion = region?.id ?? '';
    if (nextRegion === this.musicRegion) {
      // Recover if a transient map update or interrupted fade left a valid region silent.
      if (nextRegion && this.pendingMusic?.paused && !this.pendingMusicBlocked && !this.pendingMusicStarting) this.tryStartPendingMusic(this.pendingMusic, this.musicGeneration);
      else if (nextRegion && this.musicTracks.length && !this.music && !this.pendingMusic) this.startNextTrack(this.musicGeneration);
      else if (nextRegion && this.music?.paused && !this.musicFadeFrame) this.tryResumeMusic();
      return;
    }
    this.musicRegion = nextRegion;
    this.musicTracks = region?.tracks ?? [];
    this.musicTrackIndex = -1;
    const generation = ++this.musicGeneration;
    this.cancelMusicFade();
    if (this.pendingMusic) this.stopMusicElement(this.pendingMusic);
    this.pendingMusicStarting = false;
    this.pendingMusicBlocked = false;
    // A cancelled crossfade may leave its outgoing track in the instance set.
    // Keep the currently audible track alive until the destination can play,
    // but stop every older instance that no longer belongs to this transition.
    this.stopOtherMusicInstances(this.music);
    if (!this.musicTracks.length) {
      void this.stopMusic(850);
      return;
    }
    this.startNextTrack(generation);
  }

  private startNextTrack(generation: number): void {
    if (generation !== this.musicGeneration || !this.musicTracks.length || this.pendingMusic) return;
    this.musicTrackIndex = (this.musicTrackIndex + 1) % this.musicTracks.length;
    const audio = new Audio(this.base + this.musicTracks[this.musicTrackIndex]);
    this.pendingMusic = audio;
    this.musicInstances.add(audio);
    audio.loop = false;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.addEventListener('ended', () => {
      this.musicInstances.delete(audio);
      if (this.music === audio && generation === this.musicGeneration) {
        this.music = null;
        this.startNextTrack(generation);
      }
    });
    this.tryStartPendingMusic(audio, generation);
  }

  private tryStartPendingMusic(audio: HTMLAudioElement, generation: number): void {
    if (generation !== this.musicGeneration || this.pendingMusic !== audio || !this.musicRegion || this.pendingMusicStarting || this.pendingMusicBlocked) return;
    this.pendingMusicStarting = true;
    void audio.play().then(() => {
      this.pendingMusicStarting = false;
      if (generation !== this.musicGeneration || this.pendingMusic !== audio || !this.musicRegion) {
        this.stopMusicElement(audio);
        return;
      }
      const previous = this.music;
      this.pendingMusic = null;
      this.music = audio;
      this.crossfadeMusic(previous, audio, generation);
    }).catch(() => {
      this.pendingMusicStarting = false;
      if (generation !== this.musicGeneration || this.pendingMusic !== audio || !this.musicRegion) {
        this.stopMusicElement(audio);
        return;
      }
      // Keep the previous region audible. Avoid retrying every poll; wait for
      // a real user gesture because browsers may block autoplay until activation.
      this.pendingMusicBlocked = true;
      this.bindMusicRetry();
    });
  }

  private crossfadeMusic(previous: HTMLAudioElement | null, next: HTMLAudioElement, generation: number): void {
    const target = this.muted() || this.musicMuted() ? 0 : this.volume() * this.musicVolume();
    const previousStart = previous?.volume ?? 0;
    const startedAt = performance.now();
    const duration = previous ? 850 : 900;
    const tick = (now: number) => {
      if (generation !== this.musicGeneration || this.music !== next) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      next.volume = target * progress;
      if (previous) previous.volume = previousStart * (1 - progress);
      if (progress < 1) {
        this.musicFadeFrame = requestAnimationFrame(tick);
      } else {
        this.musicFadeFrame = 0;
        if (previous) this.stopMusicElement(previous);
      }
    };
    this.cancelMusicFade();
    // A newer crossfade supersedes the previous one. Retain only the pair
    // participating in the new fade; older outgoing tracks must not keep
    // playing after their animation frame has been cancelled.
    this.stopOtherMusicInstances(previous, next);
    this.musicFadeFrame = requestAnimationFrame(tick);
  }

  private stopOtherMusicInstances(...keep: Array<HTMLAudioElement | null | undefined>): void {
    const retained = new Set(keep.filter((audio): audio is HTMLAudioElement => !!audio));
    for (const audio of this.musicInstances) {
      if (!retained.has(audio)) this.stopMusicElement(audio);
    }
  }

  private stopMusicElement(audio: HTMLAudioElement): void {
    audio.pause();
    try { audio.currentTime = 0; } catch { /* Some media elements cannot seek before metadata loads. */ }
    this.musicInstances.delete(audio);
    if (this.music === audio) this.music = null;
    if (this.pendingMusic === audio) this.pendingMusic = null;
  }

  private bindMusicRetry(): void {
    if (this.musicRetryBound) return;
    this.musicRetryBound = true;
    const retry = () => {
      this.musicRetryBound = false;
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('keydown', retry, true);
      this.pendingMusicBlocked = false;
      if (this.pendingMusic) this.tryStartPendingMusic(this.pendingMusic, this.musicGeneration);
      else this.tryResumeMusic();
    };
    document.addEventListener('pointerdown', retry, { once: true, capture: true });
    document.addEventListener('keydown', retry, { once: true, capture: true });
  }

  private tryResumeMusic(): void {
    const audio = this.music;
    const generation = this.musicGeneration;
    if (!this.musicRegion || !audio || !audio.paused) return;
    void audio.play().then(() => {
      if (generation !== this.musicGeneration || this.music !== audio || !this.musicRegion) {
        this.stopMusicElement(audio);
        return;
      }
      void this.fadeVolume(audio, audio.volume, this.muted() || this.musicMuted() ? 0 : this.volume() * this.musicVolume(), 900, generation);
    }).catch(() => {
      if (generation !== this.musicGeneration || this.music !== audio || !this.musicRegion) this.stopMusicElement(audio);
      else this.bindMusicRetry();
    });
  }

  private async fadeCurrentMusic(duration: number, generation: number): Promise<void> {
    const audio = this.music;
    if (!audio) return;
    const initial = audio.volume;
    await this.fadeVolume(audio, initial, 0, duration, generation);
    if (generation !== this.musicGeneration) return;
    this.stopMusicElement(audio);
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
    if (!audio) {
      this.stopOtherMusicInstances();
      return;
    }
    this.stopOtherMusicInstances(audio);
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
    this.stopMusicElement(audio);
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
      this.playConsumedItemSound(itemId, String(entry?.id ?? ''));
      return;
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


  private playConsumedItemSound(itemId: string, battleId = ''): void {
    let sound: SoundName | null = null;
    if (itemId.startsWith('food_')) sound = 'eat';
    else if (itemId === 'fairy_in_a_bottle') sound = 'use_fairy_in_a_bottle';
    else if (itemId.startsWith('tonic_')) sound = 'use_tonic';
    else if (itemId.startsWith('pot_') || itemId.startsWith('potion_') || itemId.startsWith('elixir_') || itemId.includes('potion')) sound = 'potion_drink';
    if (!sound) return;
    this.play(sound);
    if (battleId) {
      const counts = this.battleItemSoundCounts.get(battleId) ?? new Map<string, number>();
      counts.set(itemId, Number(counts.get(itemId) ?? 0) + 1);
      this.battleItemSoundCounts.set(battleId, counts);
    }
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
    const playedCounts = this.battleItemSoundCounts.get(String(resolved.entryId)) ?? new Map<string, number>();
    for (const consumed of resolved.itemsConsumed ?? []) {
      const itemId = String((consumed as any)?.itemId ?? '');
      const quantity = Math.max(0, Number((consumed as any)?.quantity ?? 1));
      const alreadyPlayed = Number(playedCounts.get(itemId) ?? 0);
      for (let i = alreadyPlayed; i < quantity; i++) this.playConsumedItemSound(itemId);
    }
    this.battleItemSoundCounts.delete(String(resolved.entryId));
  }
}
