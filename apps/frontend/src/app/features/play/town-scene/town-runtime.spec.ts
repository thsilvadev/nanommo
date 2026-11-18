import type { TownRosterEntry, TownSceneDef } from '@nanommo/shared';
import { TownNav, positionAt } from '@nanommo/shared';
import { isWebglAvailable } from '../../../shared/character-viewer/character-viewer.component';
import { createTownRuntime, type TownRuntime } from './town-runtime';

const appearance = { v: 1, hair: 1, hairColor: 2, skin: 3, face: 0, nose: 0, mouth: 0, mouthDetails: 0, chest: 0, facialHair: 0, piercing: 0, tattoo: 0 } as const;
const entry = (characterId: string, extra: Partial<TownRosterEntry> = {}): TownRosterEntry => ({
  characterId, name: characterId, level: 7, appearance: { ...appearance }, sex: 'female', heightCm: 170, seed: 99, online: true,
  sleeping: null, wakeFrom: null, lastSeenAt: '2026-11-18T00:00:00.000Z', ...extra,
});

describe('TownRuntime (real WebGL)', () => {
  let def: TownSceneDef;
  let host: HTMLElement;
  let runtime: TownRuntime | null = null;
  const NOW = Date.UTC(2026, 10, 18, 12);

  beforeAll(async () => {
    const all = await fetch('/data/town_scenes.json').then(r => r.json());
    def = all.towns.find((t: TownSceneDef) => t.mapId === 'map_town');
  });

  beforeEach(() => {
    host = document.createElement('div');
    host.style.cssText = 'width:640px;height:480px;position:fixed;left:0;top:0';
    document.body.appendChild(host);
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = null;
    host.remove();
  });

  async function start(entries: TownRosterEntry[], selfId: string | null) {
    if (!isWebglAvailable()) pending('WebGL is not available in this browser');
    runtime = await createTownRuntime(host, {
      def, now: () => NOW, assetBase: '/assets/character/', catalogUrl: '/data/appearance_catalog.json',
      npcNames: { blacksmith_loren: 'Loren' }, selfId,
    });
    runtime.setCharacters(entries, selfId);
    await runtime.settled();
    runtime.renderNow();
    return runtime;
  }

  it('builds the town with one renderer, every NPC and every character', async () => {
    const rt = await start([entry('hero'), entry('ana', { sex: 'male' }), entry('zzz', { online: false, sleeping: { at: NOW - 1000 } })], 'hero');
    expect(host.querySelectorAll('canvas').length).toBe(1);
    expect(rt.npcCount()).toBe(Object.keys(def.npcSpots).length);
    expect(rt.activeCount()).toBe(3);
    expect(rt.animationOf('zzz')).toBe('Dead');
  });

  it('places characters where positionAt says', async () => {
    const hero = entry('hero');
    const rt = await start([hero], 'hero');
    const pose = positionAt(def, new TownNav(def), hero, NOW);
    const [x, z] = rt.worldPositionOf('character', 'hero')!;
    expect(Math.hypot(x - pose.x, z - pose.z)).toBeLessThan(1e-6);
  });

  it('picks an NPC and a character by their screen position, and nothing on empty ground', async () => {
    const rt = await start([entry('ana')], null);
    const npcAt = rt.screenPositionOf('npc', 'blacksmith_loren')!;
    expect(rt.pick(npcAt[0], npcAt[1])).toEqual({ kind: 'npc', id: 'blacksmith_loren' });
    const anaAt = rt.screenPositionOf('character', 'ana')!;
    expect(rt.pick(anaAt[0], anaAt[1])?.id).toBe('ana');
    expect(rt.pick(2, 2)).toBeNull();
  });

  it('removes characters that leave and drops its canvas on dispose', async () => {
    const rt = await start([entry('a'), entry('b')], null);
    rt.setCharacters([entry('a')], null);
    await rt.settled();
    expect(rt.activeCount()).toBe(1);
    rt.dispose();
    runtime = null;
    expect(host.querySelector('canvas')).toBeNull();
  });
});
