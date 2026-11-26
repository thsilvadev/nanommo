import { ARENA_CELL_M, ARENA_FLYER_FALL_MS, ARENA_FOCUS_DISTANCE_M, arenaFocusOrder, arenaFocusSlot, arenaHoverM, cellToWorld, frameCells, monsterScale, zoomedFrame } from './arena-camera';

const all = Array.from({ length: 100 }, (_, i) => ({ row: Math.floor(i / 10), column: i % 10 }));

describe('arena camera', () => {
  it('maps the grid centre to the world origin, columns along +x, rows along +z', () => {
    expect(cellToWorld({ row: 4.5, column: 4.5 })).toEqual({ x: 0, z: 0 });
    expect(cellToWorld({ row: 5, column: 9 }).x).toBeCloseTo(4.5 * ARENA_CELL_M, 6);
    expect(cellToWorld({ row: 9, column: 0 }).z).toBeCloseTo(4.5 * ARENA_CELL_M, 6);
  });

  it('frames a 1v1 closer than a 5v10, and a 5v10 never farther than the full grid', () => {
    const duel = frameCells([{ row: 5, column: 0 }, { row: 5, column: 9 }], 16 / 9);
    const melee = frameCells([{ row: 5, column: 4 }, { row: 5, column: 5 }], 16 / 9);
    const crowd = frameCells([...[3, 4, 5, 6, 7].map((row) => ({ row, column: 0 })), ...Array.from({ length: 10 }, (_, row) => ({ row, column: 9 }))], 16 / 9);
    const full = frameCells(all, 16 / 9);
    expect(melee.distance).toBeLessThan(duel.distance);
    expect(duel.distance).toBeLessThanOrEqual(crowd.distance);
    expect(crowd.distance).toBeLessThanOrEqual(full.distance + 1e-9);
    expect(frameCells([...all, { row: 5, column: -6 }], 16 / 9).distance).toBeCloseTo(full.distance, 6);
  });

  it('centres the frame on the occupied cells', () => {
    const f = frameCells([{ row: 5, column: 4 }, { row: 5, column: 5 }], 16 / 9);
    expect(f.targetX).toBeCloseTo(0, 6);
  });

  it('a battle laid out further right (origin) frames the same way, moved by its offset', () => {
    const here = frameCells([{ row: 5, column: 0 }, { row: 5, column: 9 }, { row: 4, column: -3 }], 16 / 9);
    const there = frameCells([{ row: 5, column: 20 }, { row: 5, column: 29 }, { row: 4, column: 17 }], 16 / 9, 20);
    expect(there.targetX - here.targetX).toBeCloseTo(20 * ARENA_CELL_M, 6);
    expect(there.distance).toBeCloseTo(here.distance, 6);
  });

  it('keeps real size but clamps a giant to its cell width', () => {
    expect(monsterScale(6, 4)).toBeCloseTo((1.1 * ARENA_CELL_M) / 6, 6);
    expect(monsterScale(0.8, 0.6)).toBe(1);
  });

  it('flying monsters (bee, mosquito) hover at 1.2 m and fall to the ground when they die; walkers stay on it', () => {
    expect(arenaHoverM('mon_mutantbee', null, 5000)).toBeCloseTo(1.2, 6);
    expect(arenaHoverM('mon_giantmosquito', null, 5000)).toBeCloseTo(1.2, 6);
    expect(arenaHoverM('mon_fieldbat', null, 5000)).toBe(0);
    expect(arenaHoverM('mon_gravelhorn', null, 5000)).toBe(0);
    expect(arenaHoverM(null, null, 5000)).toBe(0);
    // Killed at 1000: still up at the blow, falling after, on the ground once the fall is over.
    expect(arenaHoverM('mon_mutantbee', 1000, 1000)).toBeCloseTo(1.2, 6);
    const mid = arenaHoverM('mon_mutantbee', 1000, 1000 + ARENA_FLYER_FALL_MS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1.2);
    expect(arenaHoverM('mon_mutantbee', 1000, 1000 + ARENA_FLYER_FALL_MS)).toBe(0);
  });

  it('zoom 0 keeps the automatic frame; zoom 1 is a close shot centred on the focused actor', () => {
    const want = { targetX: 0, targetZ: 0, distance: 30 };
    const focus = { x: 6, z: 2 };
    expect(zoomedFrame(want, focus, 0)).toEqual(want);
    expect(zoomedFrame(want, null, 1)).toEqual(want);
    expect(zoomedFrame(want, focus, 1)).toEqual({ targetX: 6, targetZ: 2, distance: ARENA_FOCUS_DISTANCE_M });
    const half = zoomedFrame(want, focus, 0.5);
    expect(half.targetX).toBeCloseTo(3, 6);
    expect(half.distance).toBeCloseTo((30 + ARENA_FOCUS_DISTANCE_M) / 2, 6);
    // Already closer than the close shot: zooming never pulls back.
    expect(zoomedFrame({ ...want, distance: 4 }, focus, 1).distance).toBe(4);
  });

  it('focus keys: 1–9, 0, -, =, [, ], \\ then numpad 1–5 are the 1st to 20th living fighter', () => {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '[', ']', '\\'];
    keys.forEach((key, i) => expect(arenaFocusSlot({ key, code: 'X' })).withContext(key).toBe(i));
    [1, 2, 3, 4, 5].forEach((n) => expect(arenaFocusSlot({ key: String(n), code: `Numpad${n}` })).toBe(14 + n));
    expect(arenaFocusSlot({ key: '6', code: 'Numpad6' })).toBeNull();
    expect(arenaFocusSlot({ key: 'a', code: 'KeyA' })).toBeNull();
  });

  it('focus order: living fighters, the party side first', () => {
    const a = (id: string, team: 'a' | 'b', dead = false) => ({ id, team, deadAtMs: dead ? 1 : null, fleeing: null });
    expect(arenaFocusOrder([a('m1', 'b'), a('me', 'a'), a('m2', 'b', true), a('ally', 'a'), a('m3', 'b')])).toEqual(['me', 'ally', 'm1', 'm3']);
  });
});

