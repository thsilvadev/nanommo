import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { defaultAppearance } from '@nanommo/shared';
import { CharacterStore } from '../../../core/game.store';
import { CHARACTER_FACE_RENDER, CharacterFaceService, type FaceRenderEnv } from './character-face.service';

describe('CharacterFaceService', () => {
  const PNG = 'data:image/png;base64,AAA';
  let renders: number;
  let webgl: boolean;
  let character: ReturnType<typeof signal<any>>;
  const look = (hair = 2) => ({ id: 'c1', sex: 'male', heightCm: 181, dominantHand: 'right', appearance: { ...defaultAppearance(), hair } });

  function service(): CharacterFaceService {
    TestBed.resetTestingModule();
    const env: FaceRenderEnv = { webglAvailable: () => webgl, render: async () => { renders++; return PNG; } };
    TestBed.configureTestingModule({ providers: [{ provide: CHARACTER_FACE_RENDER, useValue: env }, { provide: CharacterStore, useValue: { character } }] });
    return TestBed.inject(CharacterFaceService);
  }
  beforeEach(() => {
    renders = 0; webgl = true; character = signal<any>(look());
    try { localStorage.removeItem('nanommo.face'); } catch { /* ignore */ }
  });

  it('renders once and reuses the stored face on the next load', async () => {
    const first = service();
    await first.preload();
    expect(first.url()).toBe(PNG);
    const second = service();
    await second.preload();
    expect(second.url()).toBe(PNG);
    expect(renders).toBe(1);
  });

  it('a different look renders again', async () => {
    await service().preload();
    character.set(look(3));
    await service().preload();
    expect(renders).toBe(2);
  });

  it('storage that throws still yields a face for this session', async () => {
    spyOn(localStorage, 'getItem').and.throwError('blocked');
    spyOn(localStorage, 'setItem').and.throwError('blocked');
    const face = service();
    await expectAsync(face.preload()).toBeResolved();
    expect(face.url()).toBe(PNG);
  });

  it('no appearance or no WebGL: no render, preload still finishes', async () => {
    webgl = false;
    const a = service();
    await expectAsync(a.preload()).toBeResolved();
    expect(a.url()).toBeNull();
    webgl = true;
    character.set({ id: 'c1', sex: 'male', heightCm: 181, appearance: null });
    const b = service();
    await expectAsync(b.preload(undefined, 50)).toBeResolved();
    expect(b.url()).toBeNull();
    expect(renders).toBe(0);
  });
});
