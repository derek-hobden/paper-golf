import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/rng';
import { CALM, type Dir, type Wind } from '../src/engine/types';
import { rainLook, rainVector, spawnEverySec, spawnStreak, streakPoint } from '../src/ui/rainlook';
import { dirs } from './helpers';

// The rain's look: light pencil streaks falling down the board and leaning downwind. Pure numbers, no DOM, so the
// animation in src/ui/rain.ts has nothing to decide for itself.

const BOARD = { w: 13, h: 20 };
const E: Dir = 2;
const W: Dir = 6;
const wind = (strength: Wind['strength'], dir: Dir): Wind => ({ strength, dir });

describe('rainLook', () => {
  it('has nothing falling on a dry hole', () => {
    expect(rainLook(false).streaks).toBe(0);
    expect(spawnEverySec(rainLook(false))).toBe(Infinity);
  });

  it('is a light, quick shower on a rainy one', () => {
    const look = rainLook(true);
    expect(look.streaks).toBeGreaterThan(10);
    expect(look.fallSec[0]).toBeGreaterThan(0);
    expect(look.fallSec[0]).toBeLessThanOrEqual(look.fallSec[1]);
    // Light: pencil you can read the course through, and a thin line.
    expect(look.alpha).toBeGreaterThan(0);
    expect(look.alpha).toBeLessThan(0.6);
    expect(look.width).toBeLessThan(0.1);
    expect(look.length).toBeGreaterThan(0);
  });

  it('falls in a soft rain blue, light enough to read the course through', () => {
    const [r, g, b] = rainLook(true).color;
    // Blue, clearly: well past the grey it used to be drawn in.
    expect(b).toBeGreaterThan(r + 40);
    expect(b).toBeGreaterThan(g + 15);
    // Soft and light, not a saturated primary: no channel is dark, and none is full.
    expect(Math.min(r, g, b)).toBeGreaterThan(90);
    expect(Math.max(r, g, b)).toBeLessThan(250);
    // The colour is the rain's, not the weather's: a dry hole simply has no streaks to draw with it.
    expect(rainLook(false).color).toEqual(rainLook(true).color);
  });

  it('spawns often enough to keep about that many streaks in the air', () => {
    const look = rainLook(true);
    const mean = (look.fallSec[0] + look.fallSec[1]) / 2;
    expect(spawnEverySec(look) * look.streaks).toBeCloseTo(mean, 6);
  });
});

describe('rainVector: the line the rain falls along', () => {
  it('falls straight down the page in a calm', () => {
    expect(rainVector(CALM)).toEqual({ x: 0, y: 1 });
  });

  it('leans downwind, further in a stronger wind, and never up the page', () => {
    const e1 = rainVector(wind(1, E));
    const e2 = rainVector(wind(2, E));
    expect(e1.x).toBeGreaterThan(0);
    expect(e2.x).toBeGreaterThan(e1.x);
    expect(rainVector(wind(1, W)).x).toBeCloseTo(-e1.x, 10);
    // A wind straight up or down the page does not lean it at all.
    expect(rainVector(wind(2, 0))).toEqual({ x: 0, y: 1 });
    expect(rainVector(wind(2, 4))).toEqual({ x: 0, y: 1 });
    for (const dir of dirs)
      for (const strength of [0, 1, 2] as const) {
        const v = rainVector(wind(strength, dir));
        expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 10);
        expect(v.y).toBeGreaterThan(0);
      }
  });
});

describe('spawnStreak', () => {
  it('starts off the board and crosses it, in its own time', () => {
    const look = rainLook(true);
    const rng = mulberry32(4);
    for (let i = 0; i < 200; i++) {
      const s = spawnStreak(rng, look, BOARD, wind(1, E));
      // The head starts above the page and its run carries the whole streak off the far side.
      expect(s.origin.y).toBeLessThan(0);
      const end = streakPoint(s, s.travel);
      expect(end.y).toBeGreaterThan(BOARD.h);
      // It crosses in the look's seconds (travel / speed), and runs straight.
      const secs = s.travel / s.speed;
      expect(secs).toBeGreaterThanOrEqual(look.fallSec[0] - 1e-9);
      expect(secs).toBeLessThanOrEqual(look.fallSec[1] + 1e-9);
      const mid = streakPoint(s, s.travel / 2);
      expect(mid.x).toBeCloseTo((s.origin.x + end.x) / 2, 10);
      expect(mid.y).toBeCloseTo((s.origin.y + end.y) / 2, 10);
    }
  });

  it('crosses the board somewhere a player can see: the spots cover its width', () => {
    const rng = mulberry32(11);
    const atMidHeight: number[] = [];
    for (let i = 0; i < 400; i++) {
      const s = spawnStreak(rng, rainLook(true), BOARD, CALM);
      // Where this streak passes the middle row.
      const u = (BOARD.h / 2 - s.origin.y) / s.along.y;
      atMidHeight.push(streakPoint(s, u).x);
    }
    expect(Math.min(...atMidHeight)).toBeLessThan(1.5);
    expect(Math.max(...atMidHeight)).toBeGreaterThan(BOARD.w - 1.5);
  });

  it('is deterministic: the same seed spawns the same shower', () => {
    const one = spawnStreak(mulberry32(7), rainLook(true), BOARD, wind(2, W));
    const two = spawnStreak(mulberry32(7), rainLook(true), BOARD, wind(2, W));
    expect(one).toEqual(two);
  });
});
