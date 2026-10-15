import { describe, expect, it } from 'vitest';
import { COURSES, PROPER_HOLES } from '../src/engine/generator';
import { holePar, newGame, roundPars, skipToHole } from '../src/game/game';
import { at, defined } from './helpers';
import { playHoleTypically, seededD6 } from './sim';

/** Holes simulated per par type (at least). */
const SAMPLES = 2000;
const SEED = 20261015;

describe('Proper golf simulation (typical player, real game rules)', () => {
  it('averages within ±0.75 of par on par 3s, 4s and 5s; the course is par 72', () => {
    expect(roundPars('proper').reduce((a, b) => a + b, 0)).toBe(72);
    const d6 = seededD6(SEED);
    const holesByPar = new Map<number, { c: number; h: number }[]>();
    for (let c = 0; c < COURSES.length; c++)
      for (let h = 0; h < PROPER_HOLES; h++) {
        const par = holePar('proper', h);
        holesByPar.set(par, [...(holesByPar.get(par) ?? []), { c, h }]);
      }
    const lines: string[] = [];
    for (const par of [3, 4, 5]) {
      const holes = defined(holesByPar.get(par), `par ${String(par)} holes`);
      const runs = Math.ceil(SAMPLES / holes.length);
      let strokes = 0;
      let n = 0;
      for (const { c, h } of holes)
        for (let r = 0; r < runs; r++) {
          const g = newGame(c, ['Typical'], 'proper');
          skipToHole(g, h);
          playHoleTypically(g, d6);
          strokes += defined(at(g.players, 0).scores[h], 'score');
          n++;
        }
      const avg = strokes / n;
      lines.push(`par ${String(par)}: average ${avg.toFixed(3)} strokes over ${String(n)} holes (${String(holes.length)} layouts x ${String(runs)})`);
      expect(n).toBeGreaterThanOrEqual(SAMPLES);
      expect(Math.abs(avg - par)).toBeLessThanOrEqual(0.75);
    }
    console.log(`Proper golf simulation, seed ${String(SEED)}:\n${lines.join('\n')}\ncourse par: 72`);
  });
});
