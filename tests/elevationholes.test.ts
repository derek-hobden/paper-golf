import { describe, expect, it } from 'vitest';
import {
  MAX_RAIN_COST,
  PAR_WINDOWS,
  PROPER_HOLES,
  RAIN_WINDOWS,
  generateProperHole,
  validateHole,
} from '../src/engine/generator';
import { gridAt } from '../src/engine/grid';
import { diceDistance, heightAt, hitMoves, isLandable, movesForRoll } from '../src/engine/rules';
import { diceExpectedFromTee, puttComponent } from '../src/engine/solver';
import type { Hole, P } from '../src/engine/types';
import { at, defined } from './helpers';
import { EVERY_HOLE } from './sweep';

// Elevation on the 90 generated holes. The layouts are accepted flat and lifted afterwards (`liftHole` in
// `generator.ts`), so these cases are the generator's promise: roughly one hole in three carries heights, each
// region is a merged blob and never a lone square, and every lifted hole still solves inside its par window dry and
// its rainy window wet. A hole whose heights would spoil it is left level, so a failure here means the lift kept one
// it should not have.
//
// The counts over the whole course are worked out here, at module scope, and the cases below assert what they left:
// a sweep of all 90 holes inside one test body spends the whole 30s budget on a loaded runner (tests/sweep.ts).

const HOLES: readonly Hole[] = EVERY_HOLE.map(({ c, n }) => generateProperHole(c, n));

/** Every dot of `hole` that carries a height, and the height it carries. */
function liftedCells(hole: Hole): { p: P; e: number }[] {
  const out: { p: P; e: number }[] = [];
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const e = gridAt(hole.cells, hole.w, x, y).e;
      if (e !== undefined) out.push({ p: { x, y }, e });
    }
  return out;
}

const LIFTED = HOLES.filter((h) => liftedCells(h).length > 0);

/** A hit on `hole` whose distance elevation moved, with the roll that offered it: proof the heights are played. */
function movedHit(hole: Hole): { from: P; roll: number; dist: number; base: number } | null {
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const from = { x, y };
      if (!isLandable(hole, from)) continue;
      for (let roll = 1; roll <= 6; roll++) {
        const base = diceDistance(hole, from, roll);
        if (base <= 1) continue;
        const moved = hitMoves(hole, from, base).find((m) => m.climb !== undefined);
        if (moved) return { from, roll, dist: moved.dist, base };
      }
    }
  return null;
}

const MOVED = LIFTED.map((h) => movedHit(h));

describe('elevation on the generated courses', () => {
  it('gives roughly one hole in three its heights, and leaves the rest level', () => {
    expect(HOLES).toHaveLength(5 * PROPER_HOLES);
    // About a third of 90. A lift that stopped working, or one that never refuses, shows up as a count outside this.
    expect(LIFTED.length).toBeGreaterThanOrEqual(20);
    expect(LIFTED.length).toBeLessThanOrEqual(45);
    // The level holes are level everywhere: every cell at 0, exactly as before elevation.
    for (const hole of HOLES.filter((h) => liftedCells(h).length === 0)) {
      expect(hole.cells.every((c) => c.e === undefined)).toBe(true);
    }
  });

  it('plays its heights: every lifted hole has a hit elevation moves', () => {
    expect(MOVED.filter((m) => m !== null).length).toBe(LIFTED.length);
    for (const [i, m] of MOVED.entries()) {
      const moved = defined(m, `a moved hit on lifted hole ${String(i)}`);
      expect(moved.dist).not.toBe(moved.base);
      expect(moved.dist).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(EVERY_HOLE)('course $c hole $n carries only merged blobs of −1 and +1', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    for (const { p, e } of liftedCells(hole)) {
      expect([-1, 1]).toContain(e);
      expect(heightAt(hole, p)).toBe(e);
      // Never a single isolated cell: each dot of a region touches another at the same height side by side.
      const joined = [
        { x: p.x - 1, y: p.y },
        { x: p.x + 1, y: p.y },
        { x: p.x, y: p.y - 1 },
        { x: p.x, y: p.y + 1 },
      ].some((q) => heightAt(hole, q) === e && q.x >= 0 && q.y >= 0 && q.x < hole.w && q.y < hole.h);
      expect(joined, `(${String(p.x)},${String(p.y)}) at height ${String(e)} stands alone`).toBe(true);
    }
  });

  it.each(EVERY_HOLE)('course $c hole $n still plays to its par over its heights, wet and dry', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    const window = defined(PAR_WINDOWS[hole.par], 'dry par window');
    const rainWindow = defined(RAIN_WINDOWS[hole.par], 'rainy par window');
    const cup = hole.cup.y * hole.w + hole.cup.x;
    // The cup is still reachable by putting alone, wet and dry — putts never climb — so the hole needs no forced
    // carry and goes on playing in every wind and rain the round can deal.
    expect(puttComponent(hole, hole.tee).has(cup)).toBe(true);
    expect(puttComponent(hole, hole.tee, true).has(cup)).toBe(true);
    const dry = validateHole(hole, window);
    const wet = validateHole(hole, rainWindow, true);
    expect(dry).toMatchObject({ ok: true });
    expect(wet).toMatchObject({ ok: true });
    expect(wet.diceExpected - dry.diceExpected).toBeLessThanOrEqual(MAX_RAIN_COST);
    expect(diceExpectedFromTee(hole)).toBe(dry.diceExpected);
  });

  it.each(EVERY_HOLE)('course $c hole $n offers a shot from every dot, however the ground falls', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    for (let y = 0; y < hole.h; y++)
      for (let x = 0; x < hole.w; x++) {
        const from = { x, y };
        if (!isLandable(hole, from) || (from.x === hole.cup.x && from.y === hole.cup.y)) continue;
        for (let roll = 1; roll <= 6; roll++) {
          expect(movesForRoll(hole, from, roll).length, `(${String(x)},${String(y)}) on a ${String(roll)}`).toBeGreaterThan(0);
        }
      }
  });

  it('keeps the heights it generated, the same every time', () => {
    const first = generateProperHole(0, 1);
    expect(generateProperHole(0, 1).cells.map((c) => c.e)).toEqual(first.cells.map((c) => c.e));
    // The id and the layout are untouched by the lift.
    expect(first.id).toBe('b:0:1');
    expect(at(first.cells, first.tee.y * first.w + first.tee.x).t).toBe('fairway');
  });
});
