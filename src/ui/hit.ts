/** Tap-target geometry for the board's shot markers. Coordinates are in board units (1 = one grid space). */

/** Smallest comfortable tap target, in CSS px (Apple HIG / WCAG 2.5.5). */
export const MIN_TAP_PX = 44;

/** Radius of a marker's invisible hit circle, in board units: half a cell, or more so it is >= 44 px across. */
export function hitRadius(cellPx: number): number {
  return Math.max(0.5, (MIN_TAP_PX / 2 + 1) / cellPx);
}

/**
 * Index of the centre nearest to `p` that lies within `r`, or -1. Hit circles of neighbouring markers overlap on
 * phones, so a tap goes to the marker under the finger, never to a farther one whose circle happens to be on top.
 */
export function nearestWithin(centres: readonly { x: number; y: number }[], p: { x: number; y: number }, r: number): number {
  let best = -1;
  let bestD = r;
  centres.forEach((c, i) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}
