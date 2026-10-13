import { describe, expect, it } from 'vitest';
import { holeToAscii } from '../src/engine/ascii';
import { COURSES, GRID_H, GRID_W, HOLES_PER_COURSE, LIMITS, _internal, generateHoleWithStats } from '../src/engine/generator';
import { isLandable, legalMoves, samePos } from '../src/engine/rules';
import { diceExpectation } from '../src/engine/solver';

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
    const again = _internal.build(hole.seed, COURSES[2].difficulty + (7 - 6) * 0.012);
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
    expect(hole.cells[hole.tee.y * hole.w + hole.tee.x].t).toBe('fairway');
    expect(isLandable(hole, hole.cup)).toBe(true);

    // Expected strokes under optimal play is finite from every spot the ball could rest on,
    // i.e. no roll sequence can strand a player, and the tee is within the par window.
    const v = diceExpectation(hole);
    for (let y = 0; y < hole.h; y++)
      for (let x = 0; x < hole.w; x++) {
        if (!isLandable(hole, { x, y })) continue;
        expect(Number.isFinite(v[y * hole.w + x])).toBe(true);
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
    // eslint-disable-next-line no-console
    console.log(
      'dice expected per course:',
      COURSES.map((_, c) => avg(c).toFixed(2)).join(' '),
      'attempts:',
      ALL.map(({ c, n }) => generateHoleWithStats(c, n).stats.attempts).join(','),
    );
    expect(last).toBeGreaterThan(first);
  });
});
