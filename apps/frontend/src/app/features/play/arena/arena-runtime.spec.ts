import { isWebglAvailable } from '../../../shared/character-viewer/character-viewer.component';
import { fromSoloEntry } from './arena-battle';
import { arenaScene } from './arena-phase';
import { createArenaRuntime, type ArenaActorVisual, type ArenaRuntimeHandle } from './arena-runtime';
import type { ArenaBattle } from './arena.types';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';
import { MonsterModel, releaseMonsterFilesExcept } from '../../../shared/monster-viewer/monster-model';

describe('ArenaRuntime (real WebGL)', () => {
  let host: HTMLElement;
  let runtime: ArenaRuntimeHandle | null = null;
  const battle: ArenaBattle = fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look: null, attackStyle: 'bow' })!;
  const visuals = new Map<string, ArenaActorVisual>(battle.actors.map((a) => [a.id, { id: a.id, team: a.team, kind: a.kind, name: a.name, look: a.look, monsterId: a.monsterId }]));
  const sceneAt = (now: number, current: ArenaBattle | null = battle) =>
    arenaScene({ nowMs: now, current, previous: null, next: null, nextStartAtMs: null, party: [{ id: 'char-self', look: null }], selfId: 'char-self', gatherAtMs: null });

  beforeEach(() => {
    if (!isWebglAvailable()) pending('no WebGL');
    host = document.createElement('div');
    host.style.cssText = 'width:640px;height:360px;position:relative';
    document.body.appendChild(host);
  });
  afterEach(() => { runtime?.dispose(); runtime = null; host?.remove(); });

  it('renders a 1v1 frame and creates two actor views', async () => {
    runtime = await createArenaRuntime(host, { assetBase: '/assets/character/', catalogUrl: '/data/appearance_catalog.json', onContextLost: () => undefined });
    const now = battle.startAtMs + 3000;
    runtime.setSource(() => ({ scene: sceneAt(now), visuals, region: 'green_grounds' }));
    runtime.renderOnce(now);
    expect(runtime.actorCount()).toBe(2);
    expect(host.querySelector('canvas')).not.toBeNull();
  }, 30000);

  it('removing an actor disposes its view', async () => {
    runtime = await createArenaRuntime(host, { assetBase: '/assets/character/', onContextLost: () => undefined });
    const now = battle.startAtMs + 3000;
    runtime.setSource(() => ({ scene: sceneAt(now), visuals, region: 'green_grounds' }));
    runtime.renderOnce(now);
    runtime.setSource(() => ({ scene: sceneAt(now, null), visuals, region: 'green_grounds' }));
    runtime.renderOnce(now);
    expect(runtime.actorCount()).toBe(1); // only the walking party member
  }, 30000);

  it('screen anchors exist for every visible actor, inside the canvas', async () => {
    runtime = await createArenaRuntime(host, { assetBase: '/assets/character/', onContextLost: () => undefined });
    const now = battle.startAtMs + 3000;
    runtime.setSource(() => ({ scene: sceneAt(now), visuals, region: 'green_grounds' }));
    runtime.renderOnce(now);
    const anchors = runtime.screenAnchors();
    expect([...anchors.keys()].sort()).toEqual(battle.actors.map((a) => a.id).sort());
    for (const [id, a] of anchors) {
      expect(a.visible).withContext(id).toBeTrue();
      expect(a.x).withContext(id).toBeGreaterThan(0);
      expect(a.x).withContext(id).toBeLessThan(640);
      expect(a.y).withContext(id).toBeGreaterThan(0);
      expect(a.y).withContext(id).toBeLessThan(360);
    }
  }, 30000);

  it('setActive(false) stops the loop; setActive(true) resumes it', async () => {
    runtime = await createArenaRuntime(host, { assetBase: '/assets/character/', onContextLost: () => undefined });
    runtime.setSource(() => ({ scene: sceneAt(battle.startAtMs), visuals, region: 'green_grounds' }));
    runtime.setActive(true);
    expect(runtime.isRendering()).toBeTrue();
    runtime.setActive(false);
    expect(runtime.isRendering()).toBeFalse();
  }, 30000);

  it('warmMonsters uploads every texture of the species before it is drawn', async () => {
    runtime = await createArenaRuntime(host, { assetBase: '/assets/character/', onContextLost: () => undefined });
    releaseMonsterFilesExcept([]); // a fresh parse: none of its textures is on any GPU yet
    const probe = await MonsterModel.load('mon_slime');
    const textures = new Set<unknown>();
    probe.object3d.traverse((o: any) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const v of Object.values(m ?? {})) if ((v as any)?.isTexture) textures.add(v);
    });
    probe.dispose();
    expect(textures.size).withContext('slime textures').toBeGreaterThan(0);
    const gl = WebGL2RenderingContext.prototype;
    const uploads = [spyOn(gl, 'texImage2D').and.callThrough(), spyOn(gl, 'texSubImage2D').and.callThrough(), spyOn(gl, 'texStorage2D').and.callThrough()];
    await runtime.warmMonsters(['mon_slime']);
    const uploaded = uploads.reduce((n, spy) => n + spy.calls.count(), 0);
    expect(uploaded).toBeGreaterThanOrEqual(textures.size);
  }, 30000);
});
