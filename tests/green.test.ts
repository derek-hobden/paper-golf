import { describe, expect, it } from 'vitest';
import { holeFromAscii } from '../src/engine/ascii';
import { COURSES, HOLES_PER_COURSE, generateHole } from '../src/engine/generator';
import { dotsApart, greenPuttLength, isLandable, isTapIn, movesForRoll, onGreen, puttMoves } from '../src/engine/rules';
import { diceExpectation, diceExpectedFromTee } from '../src/engine/solver';
import { DIRS } from '../src/engine/types';
import { at } from './helpers';

const N = 0;

describe('the green', () => {
  const h = holeFromAscii(['.......', '.......', '.......', '...@...', '.......', '.......', '......o']);

  it('is every cell within 2 dots of the cup, diagonals included', () => {
    expect(onGreen(h, { x: 3, y: 3 })).toBe(true);
    expect(onGreen(h, { x: 5, y: 5 })).toBe(true); // 2 dots diagonally
    expect(onGreen(h, { x: 1, y: 4 })).toBe(true);
    expect(onGreen(h, { x: 6, y: 3 })).toBe(false); // 3 dots
    expect(onGreen(h, { x: 0, y: 0 })).toBe(false);
    expect(dotsApart({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(2);
  });

  it('marks all 8 cup neighbours, and only those, as tap-ins', () => {
    for (const d of DIRS) expect(isTapIn(h, { x: h.cup.x + d.x, y: h.cup.y + d.y })).toBe(true);
    expect(isTapIn(h, h.cup)).toBe(false);
    expect(isTapIn(h, { x: 5, y: 3 })).toBe(false);
    expect(isTapIn(h, { x: 5, y: 5 })).toBe(false);
  });

  it('earns a 2-dot putt on a roll of 2 and a 3-dot putt on a roll of 3, otherwise only 1', () => {
    expect([1, 2, 3, 4, 5, 6].map(greenPuttLength)).toEqual([1, 2, 3, 1, 1, 1]);
  });

  it('only putts on the green: no hits, and the roll picks the putt length', () => {
    const from = { x: 3, y: 5 }; // 2 dots south of the cup
    const kinds = (roll: number) => new Set(movesForRoll(h, from, roll).map((m) => m.kind));
    for (let r = 1; r <= 6; r++) expect(kinds(r)).toEqual(new Set(['putt']));
    const dists = (roll: number) => new Set(movesForRoll(h, from, roll).map((m) => m.dist));
    expect(dists(1)).toEqual(new Set([1]));
    expect(dists(2)).toEqual(new Set([1, 2]));
    expect(dists(3)).toEqual(new Set([1, 3]));
    expect(dists(6)).toEqual(new Set([1]));
    // Straight at the cup: exact on a 2, one dot past on a 3 (the usual overshoot rule).
    expect(movesForRoll(h, from, 2).find((m) => m.dir === N && m.dist === 2)?.result.holed).toBe(true);
    expect(movesForRoll(h, from, 3).find((m) => m.dir === N && m.dist === 3)?.result.holed).toBe(true);
    // A 1-dot putt from 2 dots out never holes.
    expect(movesForRoll(h, from, 1).some((m) => m.result.holed)).toBe(false);
  });

  it('ignores the lie on the green (no sand or fairway modifier)', () => {
    const sandy = holeFromAscii(['...', '.@.', '...', '.s.', '..o']);
    const from = { x: 1, y: 3 };
    expect(new Set(movesForRoll(sandy, from, 3).map((m) => m.dist))).toEqual(new Set([1, 3]));
    const fair = holeFromAscii(['...', '.@.', '...', '.f.', '..o']);
    expect(new Set(movesForRoll(fair, from, 2).map((m) => m.dist))).toEqual(new Set([1, 2]));
  });

  it('keeps putts on the ground: they cannot roll through water or trees', () => {
    const wet = holeFromAscii(['.@.', '.w.', '.f.', '..o']);
    expect(puttMoves(wet, { x: 1, y: 2 }, 2).some((m) => m.dir === N)).toBe(false);
    const wooded = holeFromAscii(['.@.', '.T.', '.f.', '..o']);
    expect(movesForRoll(wooded, { x: 1, y: 2 }, 2).some((m) => m.dir === N)).toBe(false);
  });

  it('leaves play off the green unchanged: the dice distance is a hit', () => {
    const from = h.tee; // 3 dots from the cup
    const hits = movesForRoll(h, from, 4).filter((m) => m.kind === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((m) => m.dist === 4)).toBe(true);
  });
});

describe('solver with the green and tap-ins', () => {
  it('values a ball 2 dots out as 1 + (4/6): a 2 or a 3 holes, anything else leaves a tap-in', () => {
    const h = holeFromAscii(['@', '.', 'o']);
    expect(diceExpectedFromTee(h)).toBeCloseTo(1 + 4 / 6);
  });

  it('values every cup neighbour at exactly one stroke on all 60 holes', () => {
    for (let c = 0; c < COURSES.length; c++)
      for (let n = 1; n <= HOLES_PER_COURSE; n++) {
        const hole = generateHole(c, n);
        const v = diceExpectation(hole);
        for (const d of DIRS) {
          const p = { x: hole.cup.x + d.x, y: hole.cup.y + d.y };
          if (isLandable(hole, p)) expect(at(v, p.y * hole.w + p.x)).toBeCloseTo(1, 9);
        }
      }
  });
});
