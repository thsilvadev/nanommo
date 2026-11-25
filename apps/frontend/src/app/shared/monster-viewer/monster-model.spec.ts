import { CLIP_SECONDS } from '../character-animation/animation-state';
import { animationStateToMonster } from './monster-animation-state';
import { MonsterModel, parsedMonsterFiles, releaseMonsterFilesExcept, warmMonsterSpecies } from './monster-model';

describe('MonsterModel (live assets)', () => {
  const made: MonsterModel[] = [];
  afterEach(() => { while (made.length) made.pop()!.dispose(); });

  it('loads a native monster and exposes its clips and size', async () => {
    const model = await MonsterModel.load('mon_slime');
    made.push(model);
    expect(model.placeholder).toBeFalse();
    expect(model.clipNames()).toContain('Idle');
    expect(model.nativeSize.width).toBeGreaterThan(0);
    expect(model.nativeSize.height).toBeGreaterThan(0);
    let meshes = 0;
    model.object3d.traverse((o: any) => { if (o.isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(0);
  });

  it('missing monster model falls back to a placeholder', async () => {
    const model = await MonsterModel.loadOrPlaceholder('mon_does_not_exist');
    made.push(model);
    expect(model.placeholder).toBeTrue();
    expect(() => model.drive({ dead: { startedAtMs: 0 } }, 5000)).not.toThrow();
  });

  it('drive Dead holds its last frame', async () => {
    const model = await MonsterModel.load('mon_direwolf');
    made.push(model);
    model.drive({ dead: { startedAtMs: 0 } }, 600_000);
    expect(model.playingClip()).toBe('Dead');
    expect(model.clipTime('Dead')).toBeCloseTo(model.clipDuration('Dead') - 1e-3, 3);
  });

  it('two models of one species are separate instances', async () => {
    const [a, b] = await Promise.all([MonsterModel.load('mon_slime'), MonsterModel.load('mon_slime')]);
    made.push(a, b);
    expect(a.object3d).not.toBe(b.object3d);
  });
});

describe('animationStateToMonster', () => {
  it('maps the arena pose onto the monster pose', () => {
    expect(animationStateToMonster({ base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: 100, speed: 1 } })).toEqual({ dead: { startedAtMs: 100 } });
    const window = (CLIP_SECONDS.Attack / 2) * 1000;
    expect(animationStateToMonster({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: 1000, speed: 2 } }))
      .toEqual({ action: { clip: 'Attack', startedAtMs: 1000, impactAtMs: 1000 + window / 2, endsAtMs: 1000 + window } });
    expect(animationStateToMonster({ base: 'CombatIdle', cast: { startedAtMs: 1000, endsAtMs: 3000 } }).action)
      .toEqual({ clip: 'Cast', startedAtMs: 1000, impactAtMs: 3000, endsAtMs: 3200 });
    expect(animationStateToMonster({ base: 'Walk' })).toEqual({ walking: true });
    expect(animationStateToMonster({ base: 'Sprint' })).toEqual({ walking: true });
    expect(animationStateToMonster({ base: 'CombatIdle', hit: { clip: 'Damage', startedAtMs: 50 } })).toEqual({ hit: { startedAtMs: 50 } });
    expect(animationStateToMonster({ base: 'CombatIdle', oneShot: { clip: 'Stun', startedAtMs: 10, speed: 1 } })).toEqual({});
  });
});

describe('monster file cache (live assets)', () => {
  const parsed = (name: string) => parsedMonsterFiles().some((url) => url.includes(`/${name}.glb`));
  const firstTexture = (model: MonsterModel): any => {
    let found: any = null;
    model.object3d.traverse((o: any) => { if (!found && o.isMesh) found = (Array.isArray(o.material) ? o.material : [o.material]).find((m: any) => m?.map)?.map ?? null; });
    return found;
  };
  afterEach(() => releaseMonsterFilesExcept([]));

  it('warms only the species it is given', async () => {
    releaseMonsterFilesExcept([]);
    const reports: Array<[number, number]> = [];
    await warmMonsterSpecies(['mon_slime', 'mon_gravelhorn'], (d, t) => reports.push([d, t]));
    expect(parsed('slime')).toBeTrue();
    expect(parsed('gravelhorn')).toBeTrue();
    expect(parsed('wraith')).toBeFalse();
    expect(reports[reports.length - 1]).toEqual([2, 2]);
    const started = performance.now();
    const model = await MonsterModel.load('mon_gravelhorn');
    expect(performance.now() - started).toBeLessThan(50);
    model.dispose();
  }, 60_000);

  it('releases files out of the set, freeing their textures', async () => {
    // (the wraith has no textures since its cone rebuild: the gravelhorn is the textured one released)
    await warmMonsterSpecies(['mon_wraith', 'mon_gravelhorn']);
    const gravelhorn = await MonsterModel.load('mon_gravelhorn');
    const texture = firstTexture(gravelhorn);
    expect(texture).withContext('gravelhorn has a textured material').not.toBeNull();
    gravelhorn.dispose();
    const disposed = spyOn(texture, 'dispose').and.callThrough();
    expect(releaseMonsterFilesExcept(['mon_wraith'])).toBeGreaterThanOrEqual(1);
    expect(disposed).toHaveBeenCalled();
    expect(parsed('gravelhorn')).toBeFalse();
    expect(parsed('wraith')).toBeTrue();
  }, 60_000);

  it('a model in use is never released', async () => {
    const m = await MonsterModel.load('mon_gravelhorn');
    releaseMonsterFilesExcept([]);
    expect(parsed('gravelhorn')).toBeTrue();
    m.dispose();
    expect(releaseMonsterFilesExcept([])).toBeGreaterThanOrEqual(1);
    expect(parsed('gravelhorn')).toBeFalse();
  }, 60_000);

  it('a released species loads again on demand', async () => {
    await warmMonsterSpecies(['mon_slime']);
    releaseMonsterFilesExcept([]);
    const m = await MonsterModel.load('mon_slime');
    expect(m.placeholder).toBeFalse();
    expect(parsed('slime')).toBeTrue();
    m.dispose();
  }, 60_000);
});
