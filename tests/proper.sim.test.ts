/**
 * What a typical player shoots on each par type, played through the real game state machine.
 *
 * The sweep runs in the describe body, at collection, never inside a test. 2000 simulated holes cost about 8s of
 * CPU with wind, so the one test that carried all three par types spent 24s of the 30s per-test timeout on a
 * loaded CI runner (v8 coverage and four workers roughly triple each test's wall clock) and then crossed it:
 * issue 44, run 39957808581, which failed and passed on its retry. Each case below is an assertion on an answer
 * already in hand, as in tests/windrule.test.ts.
 *
 * Nothing here is random. Every (weather, par) pass has its own dice and wind seeds, so a pass no longer inherits
 * the stream position left by the passes before it: the same numbers come out whether the whole file runs or
 * `npm test -t 'par 5 holes with wind'` runs one case. The averages are 10 standard errors or more inside the ±0.75
 * band (par 5 with wind is the tightest), and they move by less than 0.05 strokes across unrelated seeds, so the
 * band is not seed luck and the tolerance is not what was failing.
 */
import { describe, expect, it } from 'vitest';
import { COURSES, PROPER_HOLES } from '../src/engine/generator';
import { mulberry32 } from '../src/engine/rng';
import { CALM } from '../src/engine/types';
import { holePar, newGame, roundPars, skipToHole } from '../src/game/game';
import { at, defined } from './helpers';
import { playHoleTypically, seededD6 } from './sim';

/** Holes simulated per par type (at least). */
const SAMPLES = 2000;
const SEED = 20261015;
/** How far a par type's average may sit from its par. */
const TOLERANCE = 0.75;

/** With wind each pass is a fresh round seed, so every layout is played in many winds; calm is the old game, kept
 * as the baseline the wind's drift is measured against. */
const WEATHER = [
  { label: 'with wind', windy: true },
  { label: 'calm', windy: false },
] as const;

interface Layout {
  c: number;
  h: number;
}

interface Average {
  label: string;
  par: number;
  avg: number;
  n: number;
  layouts: number;
  runs: number;
}

const holesByPar = new Map<number, Layout[]>();
for (let c = 0; c < COURSES.length; c++)
  for (let h = 0; h < PROPER_HOLES; h++) {
    const par = holePar(h);
    holesByPar.set(par, [...(holesByPar.get(par) ?? []), { c, h }]);
  }

/** Every layout of one par type played `runs` times each, on this pass's own seeds. */
function simulate(weather: (typeof WEATHER)[number], par: number): Average {
  const holes = defined(holesByPar.get(par), `par ${String(par)} holes`);
  const runs = Math.ceil(SAMPLES / holes.length);
  const seed = SEED + par * 10 + (weather.windy ? 1 : 2);
  const d6 = seededD6(seed);
  const windSeeds = mulberry32(seed + 5);
  let strokes = 0;
  let n = 0;
  for (const { c, h } of holes)
    for (let r = 0; r < runs; r++) {
      const g = newGame(c, ['Typical'], Math.floor(windSeeds() * 2 ** 32));
      if (!weather.windy) {
        // A round without wind (like an older save): calm on every hole, hole 1's already-rolled wind included.
        delete g.windSeed;
        g.wind = CALM;
      }
      skipToHole(g, h);
      playHoleTypically(g, d6);
      strokes += defined(at(g.players, 0).scores[h], 'score');
      n++;
    }
  return { label: weather.label, par, avg: strokes / n, n, layouts: holes.length, runs };
}

describe('Proper golf simulation (typical player, real game rules)', () => {
  const averages = WEATHER.flatMap((weather) => [3, 4, 5].map((par) => simulate(weather, par)));

  it('the course is par 72', () => {
    expect(roundPars().reduce((a, b) => a + b, 0)).toBe(72);
  });

  it.each(averages)('averages within ±0.75 of par on the par $par holes $label', ({ label, par, avg, n, layouts, runs }) => {
    const drift = Math.abs(avg - par);
    console.log(
      `Proper golf simulation, par ${String(par)} ${label}: average ${avg.toFixed(3)} strokes over ${String(n)} holes ` +
        `(${String(layouts)} layouts x ${String(runs)}), ${(TOLERANCE - drift).toFixed(3)} inside the ±${String(TOLERANCE)} band`,
    );
    expect(n).toBeGreaterThanOrEqual(SAMPLES);
    expect(drift).toBeLessThanOrEqual(TOLERANCE);
  });
});
