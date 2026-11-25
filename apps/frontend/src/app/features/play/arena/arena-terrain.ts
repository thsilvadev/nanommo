/**
 * The arena ground's relief: a smooth height field, flat across the battle grid
 * (feet stay on y = 0) and rising in gentle mounds behind and in front of it.
 * The same function runs in JS (props sit on it) and in GLSL (the ground mesh).
 *
 * Coordinates: `x` is the travel coordinate (metres walked + metres from the
 * camera), `z` the world depth (the grid spans about ±12 m). Pure, no three.js.
 */

/** Half the depth kept flat: the grid's rows (±10.8 m) plus a cell's half and feet. */
export const ARENA_FLAT_HALF_DEPTH_M = 13.5;
/** The relief eases in over this much depth past the flat band. */
const RAMP_M = 9;
/** Peak mound height behind the grid and in front of it (nearer the camera, kept lower). */
const BEHIND_M = 1.3, FRONT_M = 0.5;

export function terrainAmplitude(z: number): number {
  const d = Math.abs(z) - ARENA_FLAT_HALF_DEPTH_M;
  if (d <= 0) return 0;
  const f = Math.min(1, d / RAMP_M);
  return f * f * (3 - 2 * f) * (z < 0 ? BEHIND_M : FRONT_M);
}

/** Ground height (metres) at (x, z) for a region whose relief factor is `relief` (0 = flat). */
export function terrainHeight(x: number, z: number, relief: number): number {
  if (relief <= 0) return 0;
  const n = 0.5 * Math.sin(0.19 * x + 0.31 * z) + 0.3 * Math.sin(0.43 * x - 0.57 * z + 1.3) + 0.2 * Math.sin(0.97 * x + 0.83 * z + 2.1);
  return relief * terrainAmplitude(z) * (0.55 + 0.45 * n);
}

/** GLSL twin of terrainAmplitude / terrainHeight (keep the constants in step). */
export const TERRAIN_GLSL = /* glsl */ `
float arenaAmplitude(float z) {
  float d = abs(z) - ${ARENA_FLAT_HALF_DEPTH_M.toFixed(3)};
  if (d <= 0.0) return 0.0;
  float f = min(1.0, d / ${RAMP_M.toFixed(3)});
  return f * f * (3.0 - 2.0 * f) * (z < 0.0 ? ${BEHIND_M.toFixed(3)} : ${FRONT_M.toFixed(3)});
}
float arenaHeight(vec2 p, float relief) {
  if (relief <= 0.0) return 0.0;
  float n = 0.5 * sin(0.19 * p.x + 0.31 * p.y) + 0.3 * sin(0.43 * p.x - 0.57 * p.y + 1.3) + 0.2 * sin(0.97 * p.x + 0.83 * p.y + 2.1);
  return relief * arenaAmplitude(p.y) * (0.55 + 0.45 * n);
}
`;
