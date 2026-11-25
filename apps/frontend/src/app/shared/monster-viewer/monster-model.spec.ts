import { CLIP_SECONDS } from '../character-animation/animation-state';
import { animationStateToMonster } from './monster-animation-state';
import { MonsterModel } from './monster-model';

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
