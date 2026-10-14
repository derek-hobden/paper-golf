import { describe, expect, it } from 'vitest';
import { MIN_TAP_PX, hitRadius, nearestWithin } from '../src/ui/hit';

describe('tap targets', () => {
  it('hit circles are at least 44 px across at any cell size, and never under half a cell', () => {
    for (const cellPx of [12, 15.4, 18, 22, 26, 44, 60]) {
      const r = hitRadius(cellPx);
      expect(2 * r * cellPx).toBeGreaterThanOrEqual(MIN_TAP_PX);
      expect(r).toBeGreaterThanOrEqual(0.5);
    }
    expect(hitRadius(60)).toBe(0.5);
  });

  it('a tap where circles overlap goes to the nearest marker', () => {
    const centres = [
      { x: 5.5, y: 5.5 },
      { x: 6.5, y: 5.5 },
      { x: 6.5, y: 6.5 },
    ];
    const r = hitRadius(18);
    expect(nearestWithin(centres, { x: 5.9, y: 5.5 }, r)).toBe(0);
    expect(nearestWithin(centres, { x: 6.1, y: 5.5 }, r)).toBe(1);
    expect(nearestWithin(centres, { x: 6.5, y: 6.2 }, r)).toBe(2);
  });

  it('a tap outside every circle hits nothing', () => {
    expect(nearestWithin([{ x: 0.5, y: 0.5 }], { x: 5, y: 5 }, hitRadius(18))).toBe(-1);
    expect(nearestWithin([], { x: 0, y: 0 }, 1)).toBe(-1);
  });
});
