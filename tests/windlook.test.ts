import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/rng';
import { CALM, DIRS, type Wind } from '../src/engine/types';
import { randRange } from '../src/engine/rng';
import { spawnEverySec, spawnSwirl, swirlPoint, windLook, windVector, type Swirl } from '../src/ui/windlook';
import { at, dirs } from './helpers';

const BOARD = { w: 13, h: 20 };

describe('windLook: the wind effect per strength', () => {
  it('is still when calm: no strokes, no tree sway, no flag flutter', () => {
    const calm = windLook(CALM);
    expect(calm.strokes).toBe(0);
    expect(calm.treeSwayDeg).toBe(0);
    expect(calm.flagFlutter).toBe(0);
    // A calm wind is calm whatever its (meaningless) direction.
    for (const dir of dirs) expect(windLook({ strength: 0, dir })).toEqual(calm);
  });

  it('strength 1 is a few slow strokes and a gentle sway', () => {
    const w1 = windLook({ strength: 1, dir: 1 });
    expect(w1.strokes).toBe(3);
    expect(w1.crossSec[0]).toBeGreaterThanOrEqual(6);
    expect(w1.crossSec[1]).toBeLessThanOrEqual(8);
    expect(w1.treeSwayDeg).toBeGreaterThanOrEqual(1);
    expect(w1.treeSwayDeg).toBeLessThanOrEqual(1.5);
    expect(w1.flagFlutter).toBeGreaterThan(0);
  });

  it('strength 2 has more strokes, faster, longer, wigglier, and sways harder than strength 1', () => {
    const w1 = windLook({ strength: 1, dir: 6 });
    const w2 = windLook({ strength: 2, dir: 6 });
    expect(w2.strokes).toBeGreaterThanOrEqual(8);
    expect(w2.strokes).toBeLessThanOrEqual(10);
    expect(w2.strokes).toBeGreaterThan(w1.strokes);
    expect(w2.crossSec[0]).toBeGreaterThanOrEqual(2.5);
    expect(w2.crossSec[1]).toBeLessThanOrEqual(3.5);
    // Faster: its slowest crossing beats strength 1's quickest.
    expect(w2.crossSec[1]).toBeLessThan(w1.crossSec[0]);
    expect(w2.length).toBeGreaterThan(w1.length);
    expect(w2.amplitude).toBeGreaterThan(w1.amplitude);
    expect(w2.treeSwayDeg).toBeCloseTo(3, 5);
    expect(w2.treeSwayDeg).toBeGreaterThan(w1.treeSwayDeg);
    expect(w2.swaySec).toBeLessThan(w1.swaySec);
    expect(w2.flagFlutter).toBeGreaterThan(w1.flagFlutter);
    expect(w2.flagSec).toBeLessThan(w1.flagSec);
  });

  it('every stroke strength draws semi-transparent white pencil, never solid', () => {
    for (const strength of [1, 2] as const) {
      const look = windLook({ strength, dir: 0 });
      expect(look.alpha).toBeGreaterThan(0);
      expect(look.alpha).toBeLessThan(0.6);
    }
  });
});

describe('windVector: where the strokes travel', () => {
  it('is a unit vector towards each of the 8 directions (N is up the page)', () => {
    const expected = [
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ] as const;
    for (const dir of dirs) {
      const v = windVector(dir);
      const [ex, ey] = at(expected, dir);
      const d = DIRS[dir];
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 9);
      expect(Math.sign(v.x)).toBe(ex);
      expect(Math.sign(v.y)).toBe(ey);
      expect(Math.sign(v.x)).toBe(Math.sign(d.x));
      expect(Math.sign(v.y)).toBe(Math.sign(d.y));
      if (ex !== 0 && ey !== 0) expect(Math.abs(v.x)).toBeCloseTo(Math.SQRT1_2, 9);
    }
  });
});

describe('swirls: one travelling stroke', () => {
  const look = (w: Wind) => windLook(w);

  it('starts off the upwind edge and travels downwind until it is off the far edge', () => {
    for (const dir of dirs) {
      const l = look({ strength: 2, dir });
      const s = spawnSwirl(mulberry32(dir + 1), l, BOARD, dir);
      const v = windVector(dir);
      const start = swirlPoint(s, 0);
      const end = swirlPoint(s, s.travel);
      // Moved downwind along the wind.
      expect((end.x - start.x) * v.x + (end.y - start.y) * v.y).toBeGreaterThan(10);
      // The head starts off the board on the upwind side.
      const off = (p: { x: number; y: number }) => p.x < 0 || p.y < 0 || p.x > BOARD.w || p.y > BOARD.h;
      expect(off(start)).toBe(true);
      // And by the end even its tail has left the board.
      expect(off(swirlPoint(s, s.travel - l.length))).toBe(true);
    }
  });

  it('crosses the board in the time its strength gives it', () => {
    for (const strength of [1, 2] as const) {
      const l = look({ strength, dir: 2 });
      for (let i = 0; i < 20; i++) {
        const s = spawnSwirl(mulberry32(i + 7), l, BOARD, 2);
        const sec = s.travel / s.speed;
        expect(sec).toBeGreaterThanOrEqual(l.crossSec[0] - 1e-9);
        expect(sec).toBeLessThanOrEqual(l.crossSec[1] + 1e-9);
      }
    }
  });

  it('about one stroke in four curls into a small loop, where it doubles back on itself', () => {
    const l = look({ strength: 1, dir: 2 });
    const swirls = Array.from({ length: 400 }, (_, i) => spawnSwirl(mulberry32(i + 100), l, BOARD, 2));
    const curled = swirls.filter((s) => s.curl !== null);
    expect(curled.length / swirls.length).toBeGreaterThan(0.17);
    expect(curled.length / swirls.length).toBeLessThan(0.33);
    // Wind east: a plain stroke only ever moves east; a curl goes back west for a moment (a real loop).
    const backtracks = (s: (typeof swirls)[number]) => {
      let prev = swirlPoint(s, 0).x;
      for (let u = 0.02; u <= s.travel; u += 0.02) {
        const x = swirlPoint(s, u).x;
        if (x < prev - 1e-6) return true;
        prev = x;
      }
      return false;
    };
    expect(backtracks(at(curled, 0))).toBe(true);
    expect(backtracks(at(swirls.filter((s) => s.curl === null), 0))).toBe(false);
  });

  it('is purely visual: spawning uses only the rng it is given', () => {
    const l = look({ strength: 2, dir: 5 });
    const a = spawnSwirl(mulberry32(42), l, BOARD, 5);
    const b = spawnSwirl(mulberry32(42), l, BOARD, 5);
    expect(a).toEqual(b);
  });
});

describe('spawnEverySec: how many strokes are on the board at once', () => {
  const onBoard = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= BOARD.w && p.y <= BOARD.h;

  /** Average strokes with any part on the board, spawning at that rate (irregularly, as the animation does). */
  function visible(w: Wind): number {
    const look = windLook(w);
    const rng = mulberry32(5);
    const every = spawnEverySec(look, BOARD, w.dir);
    const live: { s: Swirl; born: number }[] = [];
    for (let t = 0; t < 400; t += every * randRange(rng, 0.4, 1.6)) live.push({ s: spawnSwirl(rng, look, BOARD, w.dir), born: t });
    let seen = 0;
    let samples = 0;
    for (let t = 20; t < 380; t += 0.5) {
      samples++;
      seen += live.filter(({ s, born }) => {
        const head = (t - born) * s.speed;
        if (head < 0 || head - look.length > s.travel) return false;
        return [0, 0.5, 1].some((f) => onBoard(swirlPoint(s, Math.max(0, head - f * look.length))));
      }).length;
    }
    return seen / samples;
  }

  it('is about 3 at strength 1 and 8 to 10 at strength 2, whatever the direction', () => {
    for (const dir of dirs) {
      const v1 = visible({ strength: 1, dir });
      const v2 = visible({ strength: 2, dir });
      expect(v1).toBeGreaterThan(2.4);
      expect(v1).toBeLessThan(3.6);
      expect(v2).toBeGreaterThan(7.5);
      expect(v2).toBeLessThan(10.5);
    }
  });

  it('never spawns when calm', () => {
    expect(spawnEverySec(windLook(CALM), BOARD, 0)).toBe(Infinity);
  });
});
