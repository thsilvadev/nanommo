import { ARENA_CELL_M, cellToWorld, frameCells, monsterScale } from './arena-camera';

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

  it('keeps real size but clamps a giant to its cell width', () => {
    expect(monsterScale(6, 4)).toBeCloseTo((1.1 * ARENA_CELL_M) / 6, 6);
    expect(monsterScale(0.8, 0.6)).toBe(1);
  });
});
