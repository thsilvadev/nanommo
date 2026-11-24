import { GameAudioService } from './game-audio.service';

describe('GameAudioService battle event routing', () => {
  let audio: GameAudioService;
  beforeEach(() => {
    localStorage.clear();
    audio = new GameAudioService();
    spyOn(audio, 'play');
  });

  afterEach(() => {
    // Some routing tests use minimal, unregistered media stubs.
    (audio as any).music = null;
    (audio as any).pendingMusic = null;
    audio.destroy();
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

  it('keeps the previous region audible when the new playlist is blocked by autoplay', async () => {
    const oldPause = jasmine.createSpy('oldPause');
    const oldMusic = { volume: 0.5, paused: false, pause: oldPause } as unknown as HTMLAudioElement;
    const newPause = jasmine.createSpy('newPause');
    const candidate = {
      volume: 0, currentTime: 0, paused: true, loop: false, preload: '',
      play: () => Promise.reject(new Error('autoplay blocked')),
      pause: newPause, addEventListener: () => {},
    } as unknown as HTMLAudioElement;
    (audio as any).music = oldMusic;
    (audio as any).musicInstances.add(oldMusic);
    spyOn(window, 'Audio').and.returnValue(candidate);

    (audio as any).updateMusic('map_green_grounds_0');
    await Promise.resolve();
    await Promise.resolve();

    expect((audio as any).music).toBe(oldMusic);
    expect(oldPause).not.toHaveBeenCalled();
    expect((audio as any).pendingMusic).toBe(candidate);
    expect((audio as any).pendingMusicBlocked).toBeTrue();
  });

  it('promotes a new region track only after its play promise succeeds', async () => {
    let resolvePlay!: () => void;
    const oldPause = jasmine.createSpy('oldPause');
    const oldMusic = { volume: 0.5, paused: false, pause: oldPause } as unknown as HTMLAudioElement;
    const candidate = {
      volume: 0, currentTime: 0, paused: false, loop: false, preload: '',
      play: () => new Promise<void>(resolve => { resolvePlay = resolve; }),
      pause: jasmine.createSpy('newPause'), addEventListener: () => {},
    } as unknown as HTMLAudioElement;
    (audio as any).music = oldMusic;
    (audio as any).musicInstances.add(oldMusic);
    spyOn(window, 'Audio').and.returnValue(candidate);
    spyOn(window, 'requestAnimationFrame').and.returnValue(321);
    spyOn(window, 'cancelAnimationFrame');

    (audio as any).updateMusic('map_green_grounds_0');
    expect((audio as any).music).toBe(oldMusic);
    resolvePlay();
    await Promise.resolve();
    await Promise.resolve();

    expect((audio as any).music).toBe(candidate);
    expect(oldPause).not.toHaveBeenCalled();
    expect((audio as any).pendingMusic).toBeNull();
  });

  it('stops orphaned outgoing tracks when a newer crossfade supersedes the previous one', () => {
    spyOn(window, 'requestAnimationFrame').and.returnValue(456);
    spyOn(window, 'cancelAnimationFrame');
    const makeTrack = () => ({ volume: 0.4, currentTime: 0, pause: jasmine.createSpy('pause') } as unknown as HTMLAudioElement);
    const trackA = makeTrack();
    const trackB = makeTrack();
    const trackC = makeTrack();
    (audio as any).musicInstances.add(trackA);
    (audio as any).musicInstances.add(trackB);
    (audio as any).musicInstances.add(trackC);
    (audio as any).music = trackC;
    (audio as any).musicGeneration = 8;

    // A was the outgoing track in a previous A -> B fade. B is now fading
    // toward C, so only B and C may remain alive.
    (audio as any).crossfadeMusic(trackB, trackC, 8);

    expect(trackA.pause).toHaveBeenCalled();
    expect(trackB.pause).not.toHaveBeenCalled();
    expect(trackC.pause).not.toHaveBeenCalled();
    expect((audio as any).musicInstances.has(trackA)).toBeFalse();
    expect((audio as any).musicInstances.has(trackB)).toBeTrue();
    expect((audio as any).musicInstances.has(trackC)).toBeTrue();
  });

  it('retries paused regional music directly from a volume interaction', () => {
    const music = { paused: true, volume: 0.2 } as HTMLAudioElement;
    (audio as any).music = music;
    const retry = jasmine.createSpy('tryResumeMusic');
    (audio as any).tryResumeMusic = retry;
    audio.setVolume(0.6);
    expect(music.volume).toBe(0.6);
    expect(retry).toHaveBeenCalledTimes(1);
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

  it('keeps General, Effects and Music volume/mute channels independently persisted', () => {
    audio.setVolume(0.6, 'general');
    audio.setVolume(0.35, 'effects');
    audio.setVolume(0.8, 'music');
    expect(audio.volume()).toBe(0.6);
    expect(audio.effectsVolume()).toBe(0.35);
    expect(audio.musicVolume()).toBe(0.8);
    audio.toggleMute('effects');
    expect(audio.effectsMuted()).toBeTrue();
    expect(audio.muted()).toBeFalse();
    expect(audio.musicMuted()).toBeFalse();
    expect(localStorage.getItem('nanommo:game-audio-effects-volume')).toBe('0.35');
    expect(localStorage.getItem('nanommo:game-audio-music-volume')).toBe('0.8');
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
    expect((audio as any).fileName('eGem')).toBe('eGem.mp3');
    expect((audio as any).fileName('flee')).toBe('flee.mp3');
    expect((audio as any).fileName('mailInbox')).toBe('new_packs/4/mailInbox.mp3');
    expect((audio as any).fileName('saveTown')).toBe('new_packs/5/save.mp3');
    expect((audio as any).fileName('boughtItemFromNpc')).toBe('new_packs/2/boughtItemFromNpc.mp3');
    expect((audio as any).fileName('soldItemToNpc')).toBe('new_packs/2/soldItemToNpc.ogg');
    expect((audio as any).fileName('putInStorage')).toBe('new_packs/2/putInStorage.ogg');
    expect((audio as any).fileName('takeFromStorage')).toBe('new_packs/2/takeFromStorage.ogg');
    expect((audio as any).fileName('postItemOnMarket')).toBe('new_packs/2/postItemOnMarket.ogg');
  });
});

describe('GameAudioService music transition ownership', () => {
  let service: any;
  let tracks: any[];
  let frames: Map<number,FrameRequestCallback>;
  let now: number;
  let nextFrame: number;
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  const advance = (milliseconds:number) => {
    now += milliseconds;
    const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(now));
  };
  beforeEach(() => {
    localStorage.clear();service=new GameAudioService();tracks=[];frames=new Map();now=0;nextFrame=0;
    spyOn(performance,'now').and.callFake(()=>now);
    spyOn(window,'requestAnimationFrame').and.callFake(callback=>{frames.set(++nextFrame,callback);return nextFrame;});
    spyOn(window,'cancelAnimationFrame').and.callFake(id=>{frames.delete(id);});
    spyOn(window,'Audio').and.callFake(function(src?:string){
      const track:any={src,volume:0,currentTime:0,paused:true,loop:false,preload:'',addEventListener:()=>{}};
      track.play=jasmine.createSpy('play').and.callFake(()=>{track.paused=false;return Promise.resolve();});
      track.pause=jasmine.createSpy('pause').and.callFake(()=>{track.paused=true;});
      tracks.push(track);return track;
    });
  });
  afterEach(()=>{service.destroy();service.cancelMusicFade();service.stopOtherMusicInstances();frames.clear();});
  it('mutes both sides of a crossfade and cannot be unmuted by a later frame', async () => {
    service.updateMusic('map_town');await flush();advance(1000);
    service.updateMusic('map_caete_1');await flush();advance(200);
    service.setVolume(0);
    expect(tracks.every(track=>track.volume===0)).toBeTrue();
    advance(200);
    expect(tracks.every(track=>track.volume===0)).toBeTrue();
    expect(tracks[0].paused).toBeTrue();
  });
  it('keeps the retained track audible if a region change interrupts its initial fade-in', async () => {
    service.updateMusic('map_town');await flush();
    // The first fade has not rendered yet; the user immediately changes areas.
    expect(tracks[0].volume).toBe(0);
    (window.Audio as unknown as jasmine.Spy).and.callFake(function(src?:string){
      const track:any={src,volume:0,currentTime:0,paused:true,addEventListener:()=>{}};
      track.play=()=>Promise.reject(new DOMException('User gesture required','NotAllowedError'));
      track.pause=()=>{};tracks.push(track);return track;
    });
    service.updateMusic('map_caete_1');await flush();
    expect(service.music).toBe(tracks[0]);
    expect(tracks[0].volume).toBe(.7);
  });
  it('honors the Music channel while a stop fade is running', async () => {
    service.updateMusic('map_town');await flush();advance(1000);
    service.updateMusic('unknown');
    service.setVolume(0,'music');advance(100);
    expect(tracks.every(track=>track.volume===0)).toBeTrue();
  });
  it('does not let a stale play completion unlock the next pending track', async () => {
    let resolveOld!:()=>void,resolveNext!:()=>void;
    service.updateMusic('map_town');await flush();advance(1000);
    // Leave the next region waiting for media startup.
    (window.Audio as unknown as jasmine.Spy).and.callFake(function(src?:string){
      const track:any={src,volume:0,currentTime:0,paused:false,addEventListener:()=>{}};
      track.pause=jasmine.createSpy('pause').and.callFake(()=>track.paused=true);
      const promise=new Promise<void>(resolve=>{if(src?.includes('caete'))resolveOld=resolve;else resolveNext=resolve;});
      track.play=jasmine.createSpy('play').and.returnValue(promise);tracks.push(track);return track;
    });
    service.updateMusic('map_caete_1');
    service.updateMusic('map_wastelands_1');
    resolveOld();await flush();
    service.setVolume(.6);
    expect(tracks[2].play).toHaveBeenCalledTimes(1);
    resolveNext();await flush();advance(1000);
    expect(service.music).toBe(tracks[2]);
    expect(tracks[2].paused).toBeFalse();
    expect(tracks.slice(0,2).every(track=>track.paused)).toBeTrue();
  });
  it('coalesces concurrent resume requests instead of creating competing fades', async () => {
    let resolvePlay!:()=>void;
    service.updateMusic('map_town');await flush();advance(1000);
    const track=tracks[0];track.paused=true;
    track.play.and.returnValue(new Promise<void>(resolve=>{resolvePlay=resolve;}));track.play.calls.reset();
    service.tryResumeMusic();service.tryResumeMusic();
    expect(track.play).toHaveBeenCalledTimes(1);
    resolvePlay();await flush();advance(1000);
    expect(service.music).toBe(track);
  });
  it('recovers paused regional music from a normal keyboard gesture without settings', async () => {
    service.updateMusic('map_town');await flush();advance(1000);
    const track=tracks[0];track.paused=true;let blocked=true;
    track.play.and.callFake(()=>{
      if(blocked){blocked=false;return Promise.reject(new DOMException('User gesture required','NotAllowedError'));}
      track.paused=false;return Promise.resolve();
    });
    service.tryResumeMusic();await flush();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));
    await flush();advance(1000);
    expect(track.paused).toBeFalse();expect(track.volume).toBe(.7);
    expect(service.musicRetryBound).toBeFalse();
  });
  it('removes autoplay retry listeners on destroy', async () => {
    service.updateMusic('map_town');await flush();advance(1000);
    const track=tracks[0];track.paused=true;
    track.play.and.returnValue(Promise.reject(new DOMException('User gesture required','NotAllowedError')));
    service.tryResumeMusic();await flush();
    const remove=spyOn(document,'removeEventListener').and.callThrough();
    service.destroy();
    expect(remove.calls.allArgs().some(args=>args[0]==='pointerdown')).toBeTrue();
    expect(remove.calls.allArgs().some(args=>args[0]==='keydown')).toBeTrue();
  });
});

describe('GameAudioService positional effects', () => {
  it('playAt scales the effects volume and sets the playback rate', () => {
    const created: HTMLAudioElement[] = [];
    const RealAudio = window.Audio;
    (window as any).Audio = function (src: string) { const a = new RealAudio(src); spyOn(a, 'play').and.resolveTo(); created.push(a); return a; };
    try {
      const audio = new GameAudioService();
      audio.volume.set(0.8);
      audio.effectsVolume.set(0.5);
      audio.muted.set(false);
      audio.effectsMuted.set(false);
      audio.playAt('pot_shatter', { volume: 0.5, rate: 1.1 });
      expect(created.length).toBe(1);
      expect(created[0].src).toContain('/assets/sounds/new_packs/7/potShatter.wav');
      expect(created[0].volume).toBeCloseTo(0.2, 5);
      expect(created[0].playbackRate).toBeCloseTo(1.1, 5);
      audio.effectsMuted.set(true);
      audio.playAt('pot_shatter', { volume: 1, rate: 1 });
      expect(created.length === 1 || created[1].volume === 0).toBeTrue();
    } finally {
      (window as any).Audio = RealAudio;
    }
  });
});
