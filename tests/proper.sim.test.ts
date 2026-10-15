import { describe, expect, it } from 'vitest';
import { COURSES, PROPER_HOLES } from '../src/engine/generator';
import { mulberry32 } from '../src/engine/rng';
import { holePar, newGame, roundPars, skipToHole } from '../src/game/game';
import { at, defined } from './helpers';
import { playHoleTypically, seededD6 } from './sim';

/** Holes simulated per par type (at least). */
const SAMPLES = 2000;
const SEED = 20261015;

describe('Proper golf simulation (typical player, real game rules)', () => {
  // With wind each run is a fresh round seed, so every layout is played in many winds; calm is the old game, kept
  // as the baseline the wind's drift is measured against.
  it.each([
    ['with wind', true],
    ['calm', false],
  ] as const)('averages within ±0.75 of par on par 3s, 4s and 5s %s; the course is par 72', (label, windy) => {
    expect(roundPars().reduce((a, b) => a + b, 0)).toBe(72);
    const d6 = seededD6(SEED);
    const windSeeds = mulberry32(SEED + 1);
    const holesByPar = new Map<number, { c: number; h: number }[]>();
    for (let c = 0; c < COURSES.length; c++)
      for (let h = 0; h < PROPER_HOLES; h++) {
        const par = holePar(h);
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
          const g = newGame(c, ['Typical'], Math.floor(windSeeds() * 2 ** 32));
          if (!windy) delete g.windSeed; // a round without wind (like an older save): calm on every hole
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
    console.log(`Proper golf simulation ${label}, seed ${String(SEED)}:\n${lines.join('\n')}\ncourse par: 72`);
  });
});
