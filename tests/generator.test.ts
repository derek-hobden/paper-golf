import { describe, expect, it } from 'vitest';
import { holeToAscii } from '../src/engine/ascii';
import { COURSES, GRID_H, GRID_W, HOLES_PER_COURSE, LIMITS, _internal, generateHoleWithStats } from '../src/engine/generator';
import { CLUBS, clubDistance, isLandable, legalMoves, resolveShot, samePos } from '../src/engine/rules';
import { diceExpectation, solveSpeed } from '../src/engine/solver';
import type { P } from '../src/engine/types';

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

  it.each(ALL)('course $c hole $n is valid and solvable in both modes', ({ c, n }) => {
    const { hole, stats } = generateHoleWithStats(c, n);
    expect(hole.w).toBe(GRID_W);
    expect(hole.h).toBe(GRID_H);
    expect(hole.cells).toHaveLength(GRID_W * GRID_H);
    expect(hole.cells[hole.tee.y * hole.w + hole.tee.x].t).toBe('fairway');
    expect(isLandable(hole, hole.cup)).toBe(true);

    // Speed Golf: replay the BFS plan through the rules engine and confirm it holes out.
    const plan = solveSpeed(hole);
    expect(plan).not.toBeNull();
    expect(plan!.strokes).toBeGreaterThanOrEqual(LIMITS.speedMin);
    expect(plan!.strokes).toBeLessThanOrEqual(LIMITS.speedMax);
    let pos: P = hole.tee;
    plan!.shots.forEach((s, i) => {
      expect(samePos(s.from, pos)).toBe(true);
      expect(clubDistance(hole, pos, s.club)).toBe(s.dist);
      const r = resolveShot(hole, pos, s.dir, s.dist);
      expect(r.legal).toBe(true);
      expect(r.holed).toBe(i === plan!.shots.length - 1);
      pos = r.end;
    });

    // Dice Golf: expected strokes under optimal play is finite from every spot the ball could rest on,
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

    // Every club is at least defined from the tee (driver needs fairway, which the tee is).
    for (const club of CLUBS) expect(clubDistance(hole, hole.tee, club)).toBeGreaterThan(0);
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
