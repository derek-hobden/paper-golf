import { describe, expect, it } from 'vitest';
import { holeFromAscii, holeToAscii } from '../src/engine/ascii';
import {
  COURSES,
  GRID_H,
  GRID_W,
  HOLES_PER_COURSE,
  LIMITS,
  _internal,
  generateCourse,
  generateHole,
  generateHoleWithStats,
  validateHole,
} from '../src/engine/generator';
import { chance, mulberry32, pick, randInt } from '../src/engine/rng';
import { PAR, isLandable, legalMoves, samePos } from '../src/engine/rules';
import { diceExpectation } from '../src/engine/solver';
import { at } from './helpers';

// Accepted seed for every hole, course by course. Pinned so that changes to validation never silently
// reshuffle the course layouts (saved rounds only store the course and hole number).
const SEEDS = [
  [1465008978, 3443951813, 1261108776, 3240043411, 2130929926, 4126629737, 1943766236, 3922709063, 1739603882, 2644796701, 461941376, 2424082667],
  [4111190401, 1864303126, 3916657915, 1665575232, 3713721301, 1471075770, 3514961423, 1268138132, 3320427897, 1073606606, 3117490259, 841292344],
  [331569136, 2312608871, 263973514, 2240689969, 999456164, 2976271307, 927633534, 2908675813, 589376264, 3644158399, 1595522594, 3572335689],
  [2981682215, 732698544, 2915066205, 670416102, 2582247027, 320716828, 2503023529, 1223862125, 2170200287, 2068773480, 4251071989, 826408385],
  [3731905174, 1147441409, 3255363564, 1211972183, 4129386690, 2094352045, 4210662680, 1626198915, 4002555502, 1397853830, 2460660548, 425625903],
];

const ALL = COURSES.flatMap((_, c) =>
  Array.from({ length: HOLES_PER_COURSE }, (_, i) => ({ c, n: i + 1 })),
);

describe('course generator', () => {
  it('has 5 courses x 12 holes = 60 holes', () => {
    expect(COURSES).toHaveLength(5);
    expect(ALL).toHaveLength(60);
  });

  it('is deterministic', () => {
    const a = _internal.build(12345, 0.5);
    const b = _internal.build(12345, 0.5);
    expect(a).toEqual(b);
    // Generating the same hole twice (bypassing the cache via a fresh build) yields the same map.
    const { hole } = generateHoleWithStats(2, 7);
    const again = _internal.build(hole.seed, at(COURSES, 2).difficulty + (7 - 6) * 0.012);
    expect(again.cells).toEqual(hole.cells);
    expect(again.tee).toEqual(hole.tee);
    expect(again.cup).toEqual(hole.cup);
  });

  it('produces distinct holes', () => {
    const maps = new Set(ALL.map(({ c, n }) => holeToAscii(generateHoleWithStats(c, n).hole).join('\n')));
    expect(maps.size).toBe(60);
  });

  it('keeps the same hole layouts (pinned seeds)', () => {
    expect(COURSES.map((_, c) => Array.from({ length: HOLES_PER_COURSE }, (_, i) => generateHoleWithStats(c, i + 1).hole.seed))).toEqual(SEEDS);
  });

  it.each(ALL)('course $c hole $n is valid and solvable', ({ c, n }) => {
    const { hole, stats } = generateHoleWithStats(c, n);
    expect(hole.w).toBe(GRID_W);
    expect(hole.h).toBe(GRID_H);
    expect(hole.cells).toHaveLength(GRID_W * GRID_H);
    expect(hole).toMatchObject({ course: c, number: n, par: PAR });
    expect(at(hole.cells, hole.tee.y * hole.w + hole.tee.x).t).toBe('fairway');
    expect(at(hole.cells, hole.cup.y * hole.w + hole.cup.x).t).toBe('fairway');
    expect(samePos(hole.tee, hole.cup)).toBe(false);
    expect(isLandable(hole, hole.cup)).toBe(true);

    // Expected strokes under optimal play is finite from every spot the ball could rest on,
    // i.e. no roll sequence can strand a player, and the tee is within the par window.
    const v = diceExpectation(hole);
    for (let y = 0; y < hole.h; y++)
      for (let x = 0; x < hole.w; x++) {
        if (!isLandable(hole, { x, y })) continue;
        expect(Number.isFinite(at(v, y * hole.w + x))).toBe(true);
        // A putt is always available.
        if (!samePos({ x, y }, hole.cup)) expect(legalMoves(hole, { x, y }, 1).length).toBeGreaterThan(0);
      }
    expect(stats.diceExpected).toBeGreaterThanOrEqual(LIMITS.diceMin);
    expect(stats.diceExpected).toBeLessThanOrEqual(LIMITS.diceMax);
  });

  it('ramps difficulty across courses', () => {
    const avg = (c: number) =>
      Array.from({ length: HOLES_PER_COURSE }, (_, i) => generateHoleWithStats(c, i + 1).stats.diceExpected).reduce(
        (a, b) => a + b,
      ) / HOLES_PER_COURSE;
    const first = avg(0);
    const last = avg(4);
    console.log(
      'dice expected per course:',
      COURSES.map((_, c) => avg(c).toFixed(2)).join(' '),
      'attempts:',
      ALL.map(({ c, n }) => generateHoleWithStats(c, n).stats.attempts).join(','),
    );
    expect(last).toBeGreaterThan(first);
  });

  it('returns the same hole for the same course and number, in course order', () => {
    const course = generateCourse(1);
    expect(course.map((h) => h.number)).toEqual(Array.from({ length: HOLES_PER_COURSE }, (_, i) => i + 1));
    expect(course.every((h) => h.course === 1)).toBe(true);
    expect(generateHole(1, 4)).toBe(at(course, 3));
    expect(generateHole(1, 4)).toEqual(generateHoleWithStats(1, 4).hole);
  });
});

describe('validateHole', () => {
  it('rejects a hole whose tee is the cup', () => {
    expect(validateHole(holeFromAscii(['@.', '..'])).ok).toBe(false);
  });

  it('rejects a hole the cup cannot be putted to', () => {
    expect(validateHole(holeFromAscii(['@..', 'www', '.o.']))).toEqual({ ok: false, diceExpected: Infinity });
  });

  it('rejects a solvable hole outside the par window', () => {
    const v = validateHole(holeFromAscii(['@', 'o']));
    expect(v.ok).toBe(false);
    expect(v.diceExpected).toBeCloseTo(1);
    expect(v.diceExpected).toBeLessThan(LIMITS.diceMin);
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
