/**
 * Fills the notches of a serrated blade (long axis +Y, grip below y=0, flat across X): on each side,
 * edge vertices are pushed out to the upper hull of the blade's half-width profile |x|(y).
 * Vertices near the spine (|x| < 30% of the hull there) and the grip (y <= 0) are kept.
 * `select(i)`: which vertices belong to the blade (e.g. by material). Mutates `positions`.
 */
export function smoothBladeEdge(positions, select) {
  const n = positions.length / 3;
  for (const sign of [1, -1]) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1];
      if (y > 0 && select(i) && (x * sign >= 0)) pts.push([y, Math.abs(x)]);
    }
    const hull = upperHull(pts);
    if (hull.length < 2) continue;
    const at = (y) => {
      for (let k = 0; k + 1 < hull.length; k++) {
        const [y0, x0] = hull[k], [y1, x1] = hull[k + 1];
        if (y >= y0 && y <= y1) return y1 === y0 ? Math.max(x0, x1) : x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
      }
      return null;
    };
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1];
      if (y <= 0 || !select(i) || x * sign <= 0) continue;
      const h = at(y);
      if (h !== null && Math.abs(x) >= 0.3 * h && Math.abs(x) < h) positions[i * 3] = sign * h;
    }
  }
}

/** Upper hull of [y, w] points (Andrew's monotone chain), sorted by y. */
function upperHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull = [];
  for (const q of p) {
    while (hull.length >= 2) {
      const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]];
      if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) >= 0) hull.pop(); else break;
    }
    hull.push(q);
  }
  return hull;
}

/**
 * Lengthens a blade (long axis +Y, metres) by `factor` above the guard at y = `from`: every vertex above
 * it moves to from + (y - from) × factor; x, z (the width) and everything at or below the guard (guard,
 * grip, pommel) stay. Mutates `positions` (flat xyz).
 */
export function stretchBlade(positions, from, factor) {
  for (let i = 1; i < positions.length; i += 3) if (positions[i] > from) positions[i] = from + (positions[i] - from) * factor;
}
