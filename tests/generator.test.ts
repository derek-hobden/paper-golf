import { describe, expect, it } from 'vitest';
import { holeFromAscii } from '../src/engine/ascii';
import {
  COURSES,
  PAR_SHAPES,
  PAR_WINDOWS,
  PROPER_PARS,
  _internal,
  generateProperHole,
  generateProperHoleWithStats,
  validateHole,
} from '../src/engine/generator';
import { chance, mulberry32, pick, randInt } from '../src/engine/rng';
import { at, defined } from './helpers';

// Every hole's validity, pinned seed and par window: tests/proper.test.ts.

describe('course generator', () => {
  it('is deterministic', () => {
    const shape = defined(PAR_SHAPES[4], 'par 4 shape');
    const a = _internal.build(12345, 0.5, shape);
    const b = _internal.build(12345, 0.5, shape);
    expect(a).toEqual(b);
    // Generating the same hole twice (bypassing the cache via a fresh build) yields the same map.
    const { hole } = generateProperHoleWithStats(2, 7);
    const again = _internal.build(
      hole.seed,
      at(COURSES, 2).difficulty + (7 - 9) * 0.008,
      defined(PAR_SHAPES[at(PROPER_PARS, 6)], 'shape'),
    );
    expect(again.cells).toEqual(hole.cells);
    expect(again.tee).toEqual(hole.tee);
    expect(again.cup).toEqual(hole.cup);
  });

  it('returns the same (cached) hole for the same course and number', () => {
    expect(generateProperHole(1, 4)).toBe(generateProperHole(1, 4));
    expect(generateProperHole(1, 4)).toEqual(generateProperHoleWithStats(1, 4).hole);
    expect(generateProperHole(1, 4)).toMatchObject({ course: 1, number: 4, par: at(PROPER_PARS, 3) });
  });
});

describe('validateHole', () => {
  it('rejects a hole whose tee is the cup', () => {
    expect(validateHole(holeFromAscii(['@.', '..']), [0, 99]).ok).toBe(false);
  });

  it('rejects a hole the cup cannot be putted to', () => {
    expect(validateHole(holeFromAscii(['@..', 'www', '.o.']), [0, 99])).toEqual({ ok: false, diceExpected: Infinity });
  });

  it('rejects a solvable hole outside the par window', () => {
    const window = defined(PAR_WINDOWS[3], 'par 3 window');
    const v = validateHole(holeFromAscii(['@', 'o']), window);
    expect(v.ok).toBe(false);
    expect(v.diceExpected).toBeCloseTo(1);
    expect(v.diceExpected).toBeLessThan(window[0]);
    expect(validateHole(holeFromAscii(['@', 'o']), [0.5, 1.5]).ok).toBe(true);
  });
});

describe('rng', () => {
  it('mulberry32 repeats per seed, differs across seeds and stays in [0, 1)', () => {
    const draw = (seed: number) => {
      const r = mulberry32(seed);
      return Array.from({ length: 200 }, () => r());
    };
    const a = draw(42);
    expect(draw(42)).toEqual(a);
    expect(draw(43)).not.toEqual(a);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('randInt is inclusive at both ends; pick and chance stay in range', () => {
    const r = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(randInt(r, 2, 5));
    expect([...seen].sort((p, q) => p - q)).toEqual([2, 3, 4, 5]);
    const xs = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 50; i++) expect(xs).toContain(pick(r, xs));
    expect(chance(r, 0)).toBe(false);
    expect(chance(r, 1)).toBe(true);
  });
});
