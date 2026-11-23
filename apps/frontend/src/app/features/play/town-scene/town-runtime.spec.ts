import type { TownRosterEntry, TownSceneDef } from '@nanommo/shared';
import { TownNav, positionAt } from '@nanommo/shared';
import { isWebglAvailable } from '../../../shared/character-viewer/character-viewer.component';
import * as THREE from 'three';
import { createTownRuntime, type TownRuntime } from './town-runtime';
import { WELL_BELL_AMPLITUDE, WELL_BELL_PERIOD_MS, buildTownWorld } from './town-world';

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

  beforeEach(async () => {
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

  it('sleeper of 60 s is lying on the first frame', async () => {
    const rt = await start([entry('zzz', { online: false, sleeping: { at: NOW - 60_000 } })], null);
    expect(rt.animationOf('zzz')).toBe('Dead');
    expect(rt.deadProgressOf('zzz')).toBe(1);
  });

  it('fresh sleeper is still falling', async () => {
    const rt = await start([entry('nap', { sleeping: { at: NOW - 200 } })], null);
    const progress = rt.deadProgressOf('nap')!;
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
  });

  it('/dance dances and an old /sit is already seated on a stool', async () => {
    const rt = await start([
      entry('dancer', { emote: { kind: 'dance', at: NOW - 5000 } }),
      entry('sitter', { emote: { kind: 'sit', at: NOW - 60_000 } }),
      entry('fresh', { emote: { kind: 'sit', at: NOW - 100 } }),
    ], null);
    rt.renderNow();
    expect(rt.animationOf('dancer')).toBe('Dance');
    expect(rt.animationOf('sitter')).toBe('Sit');
    expect(rt.stoolShownFor('sitter')).toBeTrue();
    expect(rt.stoolShownFor('dancer')).toBeFalse();
  });

  it('the ground point under the screen centre is the camera target', async () => {
    const rt = await start([], null);
    rt.centerOn(30, 25);
    const [x, z] = rt.groundPoint(320, 240)!;
    expect(Math.hypot(x - 30, z - 25)).toBeLessThan(0.5);
    rt.markDestination(x, z);
    expect(rt.effectCount()).toBe(1);
  });

  it('no aura for who is already there; an aura for who arrives and who leaves', async () => {
    const rt = await start([entry('hero'), entry('ana')], 'hero');
    expect(rt.effectCount()).toBe(0);
    rt.setCharacters([entry('hero'), entry('ana'), entry('bob')], 'hero');
    expect(rt.effectCount()).toBe(1);
    rt.setCharacters([entry('hero'), entry('bob')], 'hero');
    expect(rt.effectCount()).toBe(3); // bob's aura still playing, ana's aura and her delayed removal
    expect(rt.activeCount()).toBe(2);
  });

  it('someone who just joined gets the aura even on the first roster', async () => {
    // Checked right when the roster arrives: model loads (and shader warm-up) can outlast the 0.5 s aura.
    const rt = await start([], 'hero');
    rt.setCharacters([entry('hero', { joinedAt: NOW - 200 }), entry('ana', { joinedAt: NOW - 60_000 })], 'hero');
    expect(rt.effectCount()).toBe(1);
  });

  it('awake character has no dead progress', async () => {
    const rt = await start([entry('hero')], 'hero');
    expect(rt.deadProgressOf('hero')).toBeNull();
  });

  it('builds all five towns', async () => {
    const all: TownSceneDef[] = (await fetch('/data/town_scenes.json').then(r => r.json())).towns;
    expect(all.map(t => t.mapId).sort()).toEqual(['map_aramaia_city', 'map_emperial_capital_caelum', 'map_kwaioua_taba', 'map_outpost', 'map_town']);
    for (const town of all) {
      def = town;
      const rt = await start([entry('hero')], 'hero');
      expect(rt.npcCount()).withContext(town.mapId).toBe(Object.keys(town.npcSpots).length);
      rt.dispose();
      runtime = null;
    }
  }, 30_000);

  it('elevated NPC is pickable', async () => {
    def = (await fetch('/data/town_scenes.json').then(r => r.json())).towns.find((t: TownSceneDef) => t.mapId === 'map_emperial_capital_caelum');
    const rt = await start([], null);
    const spot = def.npcSpots['oracle'];
    expect(spot.y).toBeGreaterThan(0);
    rt.centerOn(spot.x, spot.z);
    rt.renderNow();
    const at = rt.screenPositionOf('npc', 'oracle')!;
    expect(rt.pick(at[0], at[1])).toEqual({ kind: 'npc', id: 'oracle' });
    expect(rt.worldPositionOf('npc', 'oracle')).toEqual([59, 47]);
    expect(rt.hitBoxOf('npc', 'oracle')!.minY).toBeGreaterThanOrEqual(3.2 - 1e-6);
  });

  it('setActive(false) stops the render loop; setActive(true) resumes it', async () => {
    const rt = await start([entry('a')], null);
    expect(rt.isActive()).toBeTrue();
    rt.setActive(false);
    expect(rt.isActive()).toBeFalse();
    rt.setActive(true);
    expect(rt.isActive()).toBeTrue();
  });

  it('warmTownAssets fills the shared cache without throwing', async () => {
    const { warmTownAssets } = await import('./town-runtime');
    await expectAsync(warmTownAssets('/assets/character/', '/data/appearance_catalog.json')).toBeResolved();
  });

  it('one blue selection ring at a time, for a player or an NPC', async () => {
    const rt = await start([entry('a'), entry('b')], null);
    const npcId = Object.keys(def.npcSpots)[0];
    rt.setSelection({ kind: 'character', id: 'a' });
    expect(rt.selectedOf('character', 'a')).toBeTrue();
    expect(rt.selectedOf('character', 'b')).toBeFalse();
    rt.setSelection({ kind: 'npc', id: npcId });
    expect(rt.selectedOf('character', 'a')).toBeFalse();
    expect(rt.selectedOf('npc', npcId)).toBeTrue();
    rt.setSelection(null);
    expect(rt.selectedOf('npc', npcId)).toBeFalse();
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

describe('TownWorld campfire', () => {
  it('campfire light flickers deterministically', async () => {
    const all = await fetch('/data/town_scenes.json').then(r => r.json());
    const taba: TownSceneDef = all.towns.find((t: TownSceneDef) => t.mapId === 'map_kwaioua_taba');
    const world = buildTownWorld(taba);
    const fire = world.group.getObjectByName('campfire-light') as THREE.PointLight;
    expect(fire).toBeTruthy();
    const T = Date.UTC(2026, 10, 18, 12);
    world.update(T);
    const first = fire.intensity;
    world.update(T);
    expect(fire.intensity).toBe(first);
    world.update(T + 120);
    expect(fire.intensity).not.toBe(first);
    world.dispose();
  });
});

describe('Sierra well bell', () => {
  it('swings like a pendulum: same amplitude every swing, only ever still at the ends', async () => {
    const all = await fetch('/data/town_scenes.json').then(r => r.json());
    const world = buildTownWorld(all.towns.find((t: TownSceneDef) => t.mapId === 'map_town'));
    const bell = world.group.getObjectByName('well-bell')!;
    const T0 = Date.UTC(2026, 10, 21, 3);
    const angles: number[] = [];
    for (let t = 0; t <= 30_000; t += 10) { world.update(T0 + t); angles.push(bell.rotation.x); }
    expect(Math.max(...angles)).toBeCloseTo(WELL_BELL_AMPLITUDE, 2);
    expect(Math.min(...angles)).toBeCloseTo(-WELL_BELL_AMPLITUDE, 2);
    for (let i = 1; i < angles.length - 1; i++) {
      const speed = Math.abs(angles[i + 1] - angles[i - 1]) / 20; // rad/ms
      // Slow only near the turning points (as a pendulum), never in the middle of a swing.
      if (Math.abs(angles[i]) < 0.8 * WELL_BELL_AMPLITUDE) expect(speed).toBeGreaterThan(0.0005);
    }
    let turns = 0;
    for (let i = 1; i < angles.length - 1; i++) if ((angles[i] - angles[i - 1]) * (angles[i + 1] - angles[i]) < 0) turns++;
    // Two turning points per period and no extra ones (an extra pair would be a stall/reversal mid-swing).
    expect(Math.abs(turns - (2 * 30_000) / WELL_BELL_PERIOD_MS)).toBeLessThanOrEqual(1);
    world.dispose();
  });
});

describe('TownWorld animated pieces', () => {
  const T = Date.UTC(2026, 10, 18, 12);
  const pieces: Array<[string, string]> = [
    ['map_emperial_capital_caelum', 'fountain-water'],
    ['map_emperial_capital_caelum', 'fountain-ripple'],
    ['map_kwaioua_taba', 'ember'],
    ['map_aramaia_city', 'altar-pebble'],
    ['map_town', 'well-bell'],
  ];
  const state = (o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    const map = (mesh.material as THREE.MeshStandardMaterial | undefined)?.map;
    return JSON.stringify([o.position.toArray(), o.rotation.toArray(), o.scale.toArray(), map ? map.offset.toArray() : null]);
  };

  for (const [mapId, name] of pieces) {
    it(`${name} (${mapId}) moves with the clock, deterministically`, async () => {
      const all = await fetch('/data/town_scenes.json').then(r => r.json());
      const world = buildTownWorld(all.towns.find((t: TownSceneDef) => t.mapId === mapId));
      const piece = world.group.getObjectByName(name);
      expect(piece).withContext(name).toBeTruthy();
      world.update(T);
      const first = state(piece!);
      world.update(T);
      expect(state(piece!)).toBe(first);
      world.update(T + 120);
      expect(state(piece!)).not.toBe(first);
      world.dispose();
    });
  }
});

describe('TownWorld houses and ground', () => {
  const towns = () => fetch('/data/town_scenes.json').then(r => r.json()).then(c => c.towns as TownSceneDef[]);

  it('every roof is a rectangle that covers its walls (never a skewed rhombus), with small variations', async () => {
    const looks = new Set<string>();
    for (const def of await towns()) {
      const world = buildTownWorld(def);
      const houses = world.group.children.filter(c => c.name === 'obstacle:house');
      expect(houses.length).withContext(def.mapId).toBe(def.obstacles.filter(o => o.kind === 'house').length);
      for (const house of houses) {
        const roof = house.getObjectByName('roof') as THREE.Mesh;
        const walls = house.children[0] as THREE.Mesh;
        roof.geometry.computeBoundingBox();
        walls.geometry.computeBoundingBox();
        const r = roof.geometry.boundingBox!, w = walls.geometry.boundingBox!;
        // The eave corners are exactly the bounding box corners: a rectangle, not a rhombus.
        const pos = roof.geometry.getAttribute('position');
        const corners = new Set<string>();
        for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i)) < 1e-6) corners.add(`${pos.getX(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`);
        expect([...corners].sort()).withContext(def.mapId).toEqual([
          `${r.min.x.toFixed(3)},${r.min.z.toFixed(3)}`, `${r.min.x.toFixed(3)},${r.max.z.toFixed(3)}`,
          `${r.max.x.toFixed(3)},${r.min.z.toFixed(3)}`, `${r.max.x.toFixed(3)},${r.max.z.toFixed(3)}`,
        ].sort());
        expect(r.min.x).toBeLessThan(w.min.x - 0.35);
        expect(r.max.x).toBeGreaterThan(w.max.x + 0.35);
        expect(r.min.z).toBeLessThan(w.min.z - 0.35);
        expect(r.max.z).toBeGreaterThan(w.max.z + 0.35);
        expect(roof.position.y).toBeLessThanOrEqual(w.max.y + walls.position.y);
        looks.add(`${(roof.material as THREE.MeshStandardMaterial).color.getHexString()}:${r.max.y.toFixed(2)}`);
      }
      world.dispose();
    }
    expect(looks.size).toBeGreaterThan(10);
  });

  it('Sierra mixes green over the clay ground; other towns do not', async () => {
    for (const def of await towns()) {
      const world = buildTownWorld(def);
      expect(!!world.group.getObjectByName('ground-mix')).withContext(def.mapId).toBe(def.mapId === 'map_town');
      world.dispose();
    }
  });
});
