import { describe, expect, it } from 'vitest';
import { holeFromAscii } from '../src/engine/ascii';
import {
  elevatedDistance,
  elevationShift,
  heightAt,
  hitMoves,
  movesForRoll,
  resolveShot,
  uniformElevation,
} from '../src/engine/rules';
import { diceExpectedFromTee } from '../src/engine/solver';
import type { Dir, Wind } from '../src/engine/types';
import { availableMoves, newBuiltRound, roll, shoot } from '../src/game/game';
import { defined } from './helpers';

const N: Dir = 0;
const E: Dir = 2;
const S: Dir = 4;

// Heights in the second map: `+` raised (+1), `-` low (−1), anything else level. The ball is hit from the tee (`o`, on
// rough), so the lie adds nothing: a roll of r is a hit of r before the ground has its say.

describe('elevation: the distance rule', () => {
  // A column hit north from the bottom: the normal landing for a 3 is row 3, for a 4 row 2.
  const column = (heights: string[]) => holeFromAscii(['@', '.', '.', '.', '.', '.', 'o'], heights);

  it('reads every cell as level unless it says otherwise, and off the page is level', () => {
    const h = column(['.', '.', '.', '+', '-', '.', '.']);
    expect(heightAt(h, { x: 0, y: 3 })).toBe(1);
    expect(heightAt(h, { x: 0, y: 4 })).toBe(-1);
    expect(heightAt(h, { x: 0, y: 0 })).toBe(0);
    expect(heightAt(h, { x: 5, y: 5 })).toBe(0);
  });

  it('hits one shorter onto a plateau (uphill)', () => {
    const h = column(['.', '.', '.', '+', '.', '.', '.']);
    expect(elevationShift(h, h.tee, N, 3)).toBe(-1);
    expect(elevatedDistance(h, h.tee, N, 3)).toBe(2);
    const hit = defined(hitMoves(h, h.tee, 3).find((m) => m.dir === N));
    expect(hit).toMatchObject({ dist: 2, elevation: { change: -1, climb: 1 }, result: { legal: true, end: { x: 0, y: 4 } } });
    // Where the ball would have come down on level ground, for the dashed ring.
    expect(hit.elevation?.plain).toEqual({ x: 0, y: 3 });
  });

  it('hits one further down off a plateau (downhill)', () => {
    const h = column(['.', '.', '.', '.', '.', '.', '+']);
    expect(elevatedDistance(h, h.tee, N, 3)).toBe(4);
    expect(defined(hitMoves(h, h.tee, 3).find((m) => m.dir === N)).result.end).toEqual({ x: 0, y: 2 });
  });

  it('hits two further from a plateau down into a dip, and two shorter the other way', () => {
    const down = column(['.', '.', '.', '-', '.', '.', '+']);
    expect(elevationShift(down, down.tee, N, 3)).toBe(2);
    expect(elevatedDistance(down, down.tee, N, 3)).toBe(5);
    const up = column(['.', '.', '.', '+', '.', '.', '-']);
    expect(elevatedDistance(up, up.tee, N, 3)).toBe(1);
  });

  it('never makes a hit shorter than 1', () => {
    const h = column(['.', '.', '.', '.', '+', '.', '-']);
    expect(elevatedDistance(h, h.tee, N, 2)).toBe(1);
    expect(defined(hitMoves(h, h.tee, 2).find((m) => m.dir === N)).result.end).toEqual({ x: 0, y: 5 });
  });

  it('judges the normal landing only: the new landing is never checked again', () => {
    // Uphill onto row 3 moves the landing back to row 4, which is low: no second pass makes it longer again.
    const up = column(['.', '.', '.', '+', '-', '.', '.']);
    expect(defined(hitMoves(up, up.tee, 3).find((m) => m.dir === N)).result.end).toEqual({ x: 0, y: 4 });
    // Downhill into row 3 carries on to row 2, which is raised: it still goes the one further.
    const down = column(['.', '.', '+', '-', '.', '.', '.']);
    expect(defined(hitMoves(down, down.tee, 3).find((m) => m.dir === N)).result.end).toEqual({ x: 0, y: 2 });
  });

  it('is worked out per direction, so the markers move by different amounts', () => {
    const h = holeFromAscii(['.......', '.......', '.......', '...o...', '.......', '.......', '......@'], [
      '...+...',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '...-...',
    ]);
    const moves = hitMoves(h, h.tee, 3);
    const by = (d: Dir) => defined(moves.find((m) => m.dir === d));
    expect(by(N)).toMatchObject({ dist: 2, elevation: { change: -1 } });
    expect(by(E)).toMatchObject({ dist: 3 });
    expect(by(E).elevation).toBeUndefined();
    // South, downhill into the dip: one further is off the page, so that marker is not offered at all.
    expect(moves.some((m) => m.dir === S)).toBe(false);
  });

  it('heights do not care what the ground is: a raised sand trap is still sand', () => {
    const h = { ...holeFromAscii(['@', '.', '.', '.', '.', 's'], ['.', '.', '.', '.', '.', '+']), tee: { x: 0, y: 5 } };
    // From raised sand, a roll of 4 is a hit of 3 (sand −1), then one further downhill.
    const hits = movesForRoll(h, h.tee, 4).filter((m) => m.kind === 'hit');
    expect(defined(hits.find((m) => m.dir === N))).toMatchObject({ dist: 4, elevation: { change: 1, climb: -1 } });
  });

  it('offers no hit where the lie offers none: a hit of 1 or less is still only a putt', () => {
    // Raised rough, roll of 1: today that is the putt alone, and the downhill does not turn it into a hit.
    const h = column(['.', '.', '.', '.', '.', '.', '+']);
    expect(movesForRoll(h, h.tee, 1).every((m) => m.kind === 'putt')).toBe(true);
  });

  it('leaves putts alone: the 1-dot putt and the green putts ignore heights', () => {
    const h = holeFromAscii(['.', '@', '.', '.', '.', 'o'], ['.', '.', '+', '+', '+', '-']);
    const putts = movesForRoll(h, h.tee, 3).filter((m) => m.kind === 'putt');
    expect(putts.map((m) => m.dist)).toEqual([1]);
    expect(putts.every((m) => m.elevation === undefined)).toBe(true);
    // On the green (row 3 is two from the cup), a 3 putts 3 dots, uphill or not.
    const green = holeFromAscii(['.', '@', '.', 'o', '.', '.'], ['.', '+', '+', '-', '.', '.']);
    const long = defined(movesForRoll(green, green.tee, 2).find((m) => m.dist === 2 && m.dir === N));
    expect(long).toMatchObject({ kind: 'putt', result: { holed: true } });
    expect(long.elevation).toBeUndefined();
  });

  it('applies before the wind and the slopes, which then work exactly as today', () => {
    const wind: Wind = { strength: 1, dir: E };
    const h = holeFromAscii(['....', '....', '....', '....', '....', '....', 'o..@'], [
      '....',
      '....',
      '....',
      '+...',
      '....',
      '....',
      '....',
    ]);
    // Uphill: a 3 goes 2, to row 4, and the wind then pushes it one east.
    const blown = defined(hitMoves(h, h.tee, 3, wind).find((m) => m.dir === N));
    expect(blown.result).toMatchObject({ landing: { x: 0, y: 4 }, end: { x: 1, y: 4 }, blown: true });
    // The same with a slope on the shortened landing: it rolls the ball on from there.
    const sloped = holeFromAscii(['....', '....', '....', '....', '>...', '....', 'o..@'], [
      '....',
      '....',
      '....',
      '+...',
      '....',
      '....',
      '....',
    ]);
    expect(defined(hitMoves(sloped, sloped.tee, 3).find((m) => m.dir === N)).result).toMatchObject({
      landing: { x: 0, y: 4 },
      end: { x: 1, y: 4 },
      rolled: true,
    });
  });

  it('holes a shot whose adjusted path reaches the cup', () => {
    // A 2 north is short of the cup on row 3; downhill into the dip it goes 3 and drops.
    const h = holeFromAscii(['.', '.', '.', '@', '.', '.', 'o'], ['.', '.', '.', '.', '-', '.', '.']);
    expect(resolveShot(h, h.tee, N, 2).holed).toBe(false);
    const hit = defined(hitMoves(h, h.tee, 2).find((m) => m.dir === N));
    expect(hit).toMatchObject({ dist: 3, result: { holed: true } });
    // And the overshoot by one still drops on the adjusted path: a 5 would fly over the cup, but uphill it goes 4, one
    // past the cup, and drops.
    const up = holeFromAscii(['.', '.', '.', '@', '.', '.', 'o'], ['.', '+', '.', '.', '.', '.', '.']);
    expect(resolveShot(up, up.tee, N, 5).holed).toBe(false);
    expect(defined(hitMoves(up, up.tee, 5).find((m) => m.dir === N)).result.holed).toBe(true);
  });

  it('finds the one shift every offered hit shares, or none', () => {
    // A ball on a plateau with level ground all round: every hit goes one further.
    const rows = Array.from({ length: 11 }, (_, y) => (y === 5 ? '.....o.....' : y === 10 ? '..........@' : '...........'));
    const plateau = holeFromAscii(rows, rows.map((_, y) => (y >= 4 && y <= 6 ? '....+++....' : '...........')));
    const moves = movesForRoll(plateau, plateau.tee, 3);
    expect(uniformElevation(moves)).toBe(1);
    expect(moves.filter((m) => m.kind === 'hit').every((m) => m.dist === 4)).toBe(true);
    const flat = holeFromAscii(['.......', '.......', '.......', '...o...', '.......', '.......', '......@']);
    expect(uniformElevation(movesForRoll(flat, flat.tee, 3))).toBe(0);
    const mixed = holeFromAscii(['.......', '.......', '.......', '...o...', '.......', '.......', '......@'], [
      '...+...',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
    ]);
    expect(uniformElevation(movesForRoll(mixed, mixed.tee, 3))).toBe(0);
  });
});

describe('elevation in the game and the solver', () => {
  it('plays a hit of 1 uphill as a hit, in the wind, not as the putt in the same direction', () => {
    const h = holeFromAscii(['.....', '.....', '.....', '.....', 'o...@'], ['.....', '.....', '+....', '.....', '-....']);
    // A seed whose first hole blows: find one rather than trust a number.
    let seed = 0;
    for (; seed < 500; seed++) {
      const g = newBuiltRound(h, ['A'], seed, seed);
      if (g.rain !== true && (g.wind?.strength ?? 0) > 0 && g.wind?.dir === E) break;
    }
    const g = newBuiltRound(h, ['A'], seed, seed);
    roll(g, 2);
    const hit = availableMoves(g).find((m) => m.kind === 'hit' && m.dir === N);
    const putt = availableMoves(g).find((m) => m.kind === 'putt' && m.dir === N);
    expect(hit?.dist).toBe(1);
    expect(putt?.dist).toBe(1);
    const { record } = shoot(g, N, 1, 'hit');
    expect(record.kind).toBe('hit');
    expect(record.blown).toBe(true);
  });

  it('values a hole by its heights: a fairway downhill all the way plays shorter than the flat one', () => {
    const rows = ['@', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', 'o'];
    const flat = holeFromAscii(rows);
    const downhill = holeFromAscii(rows, ['-', '-', '-', '-', '-', '-', '-', '.', '.', '.', '.', '.', '.', '.', '+']);
    expect(diceExpectedFromTee(downhill)).toBeLessThan(diceExpectedFromTee(flat));
  });
});
