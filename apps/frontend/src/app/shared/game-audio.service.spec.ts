import { GameAudioService } from './game-audio.service';

describe('GameAudioService battle event routing', () => {
  let audio: GameAudioService;
  beforeEach(() => {
    audio = new GameAudioService();
    spyOn(audio, 'play');
  });

  it('varies the monster incoming-hit effect only for monster-to-character damage', () => {
    const event = { actor: 'monster', action: 'attack', target: 'character', hit: true, damage: 12 };
    (audio as any).playBattleEvent(event, { log: { header: {} } });
    (audio as any).playBattleEvent(event, { log: { header: {} } });
    expect(audio.play).toHaveBeenCalledWith('enemy_hit_1');
    expect(audio.play).toHaveBeenCalledWith('enemy_hit_2');
  });

  it('does not route character damage to a future PvP opponent through monster-hit audio', () => {
    (audio as any).playBattleEvent({ actor: 'character', action: 'attack', target: 'opponent', hit: true, damage: 12 }, { log: { header: {} } });
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('routes ranged weapon damage to arrow hit audio', () => {
    (audio as any).playBattleEvent({ actor: 'character', action: 'attack', target: 'monster', hit: true, damage: 12, damageType: 'ranged' }, { log: { header: { characterSnapshot: { equippedWeaponTypes: ['bow'] } } } });
    expect(audio.play).toHaveBeenCalledWith('arrow_hit_1');
  });

  it('plays the matching fire and light-wisp skill effects', () => {
    const entry = { log: { header: { characterSnapshot: {} } } };
    (audio as any).playBattleEvent({ actor: 'character', action: 'use_skill', skillId: 'fire_ball', target: 'monster', damage: 20 }, entry);
    (audio as any).playBattleEvent({ actor: 'character', action: 'use_skill', skillId: 'fire_blast', target: 'monster', damage: 20 }, entry);
    (audio as any).playBattleEvent({ actor: 'character', action: 'use_skill', skillId: 'light_wisp', target: 'monster', damage: 20 }, entry);
    expect(audio.play).toHaveBeenCalledWith('fire_hit_1');
    expect(audio.play).toHaveBeenCalledWith('fire_hit_2');
    expect(audio.play).toHaveBeenCalledWith('light_hit_1');
  });

  it('plays poison sounds for poison application and damage events', () => {
    const entry = { log: { header: {} } };
    (audio as any).playBattleEvent({ actor: 'monster', action: 'status_applied', status: 'poison', target: 'character' }, entry);
    (audio as any).playBattleEvent({ actor: 'character', action: 'status_applied', status: 'poison', target: 'monster' }, entry);
    (audio as any).playBattleEvent({ actor: 'monster', action: 'status_damage', status: 'poison', target: 'character', damage: 3 }, entry);
    expect(audio.play).toHaveBeenCalledWith('poisonApply');
    expect(audio.play).toHaveBeenCalledWith('poisonDamage');
  });

  it('resolves an interrupted fade so a newer region transition is not blocked', async () => {
    spyOn(window, 'requestAnimationFrame').and.returnValue(123);
    spyOn(window, 'cancelAnimationFrame');
    const element = { volume: 0.4 } as HTMLAudioElement;
    (audio as any).music = element;
    (audio as any).musicGeneration = 1;
    const fade = (audio as any).fadeVolume(element, 0.4, 0, 850, 1) as Promise<void>;
    (audio as any).cancelMusicFade();
    await fade;
    expect((audio as any).musicFadeFrame).toBe(0);
  });

  it('stops a music instance when its play promise resolves after a region change', async () => {
    let resolvePlay!: () => void;
    const playPromise = new Promise<void>(resolve => { resolvePlay = resolve; });
    const pause = jasmine.createSpy('pause');
    const fakeAudio = {
      volume: 0,
      currentTime: 0,
      paused: false,
      loop: false,
      preload: '',
      play: () => playPromise,
      pause,
      addEventListener: () => {},
    } as unknown as HTMLAudioElement;
    spyOn(window, 'Audio').and.returnValue(fakeAudio);

    (audio as any).musicGeneration = 4;
    (audio as any).musicRegion = 'sierra-village';
    (audio as any).musicTracks = ['sierra-village.mp3'];
    (audio as any).startNextTrack(4);

    (audio as any).musicGeneration = 5;
    (audio as any).musicRegion = 'green-grounds';
    (audio as any).musicTracks = ['green-grounds.mp3'];
    resolvePlay();
    await Promise.resolve();
    await Promise.resolve();

    expect(pause).toHaveBeenCalled();
    expect((audio as any).musicInstances.size).toBe(0);
  });

  it('persists game audio volume and mute preferences', () => {
    audio.setVolume(0.42);
    expect(localStorage.getItem('nanommo:game-audio-volume')).toBe('0.42');
    expect(localStorage.getItem('nanommo:game-audio-muted')).toBe('false');
    audio.toggleMute();
    expect(localStorage.getItem('nanommo:game-audio-muted')).toBe('true');
    audio.toggleMute();
    expect(localStorage.getItem('nanommo:game-audio-muted')).toBe('false');
  });

  it('plays the potion sound for potion-use events', () => {
    (audio as any).playBattleEvent({ actor: 'character', action: 'use_item', itemId: 'pot_hp_small', target: 'character' }, { log: { header: {} } });
    expect(audio.play).toHaveBeenCalledWith('potion_drink');
  });

  it('plays flee audio only after a confirmed flee resolution', () => {
    (audio as any).updateResolvedAudio({ lastResolved: () => ({ entryId: 'battle-flee-1', cancellationReason: 'flee', drops: [] }) });
    expect(audio.play).toHaveBeenCalledWith('flee');
  });

  it('maps every new region and its numbered maps to the intended playlist', () => {
    const region = (mapId: string) => (audio as any).regionFor(mapId);
    expect(region('map_emperial_capital_caelum').id).toBe('caelum');
    expect(region('map_green_grounds_5').tracks).toEqual(['green-grounds.mp3', 'green-grounds_2.mp3', 'green-grounds_3.mp3']);
    expect(region('map_caete_7').tracks).toEqual(['caete.mp3', 'caete_2.mp3', 'caete_3.mp3']);
    expect(region('map_forest_ruins_3').tracks).toEqual(['forest-ruins.mp3', 'forest-ruins_2.mp3', 'forest-ruins_3.mp3', 'forest-ruins_4.mp3']);
    expect(region('map_gods_bridge').tracks).toEqual(['gods-bridge.mp3']);
    expect(region('map_ipora_beach_1').tracks).toEqual(['ipora-beach.mp3', 'ipora-beach_2.mp3']);
    expect(region('map_kwaioua_forest_7').tracks).toEqual(['kwaioua-forest.mp3', 'kwaioua-forest_2.mp3', 'kwaioua-forest_3.mp3']);
    expect(region('map_menace_hills_3').tracks).toEqual(['menace-hills.mp3', 'menace-hills_2.mp3', 'menace-hills_3.mp3']);
    expect(region('map_outpost').tracks).toEqual(['outpost.mp3']);
    expect(region('map_wastelands_2').tracks).toEqual(['wastelands.mp3', 'wastelands_2.mp3', 'wastelands_3.mp3']);
    expect(region('map_aramaia_city').tracks).toEqual(['aramaia-city.mp3']);
  });

  it('resolves all newly added interaction effects to their copied runtime paths', () => {
    expect((audio as any).fileName('foodCooked')).toBe('new_packs/2/foodCooked.mp3');
    expect((audio as any).fileName('gather')).toBe('new_packs/2/gather.mp3');
    expect((audio as any).fileName('boughtItemFromNpc')).toBe('new_packs/2/boughtItemFromNpc.ogg');
    expect((audio as any).fileName('soldItemToNpc')).toBe('new_packs/2/soldItemToNpc.ogg');
    expect((audio as any).fileName('putInStorage')).toBe('new_packs/2/putInStorage.ogg');
    expect((audio as any).fileName('takeFromStorage')).toBe('new_packs/2/takeFromStorage.ogg');
    expect((audio as any).fileName('postItemOnMarket')).toBe('new_packs/2/postItemOnMarket.ogg');
  });
});
