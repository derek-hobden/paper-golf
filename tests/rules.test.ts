import { describe, expect, it } from 'vitest';
import { holeFromAscii } from '../src/engine/ascii';
import { diceDistance, legalMoves, resolveShot } from '../src/engine/rules';
import { diceExpectedFromTee } from '../src/engine/solver';

const N = 0;
const NE = 1;

describe('resolveShot', () => {
  it('moves exactly the distance in a straight line, including diagonals', () => {
    const h = holeFromAscii(['.....', '.....', '.....', '..o..', '....@']);
    expect(resolveShot(h, h.tee, N, 3)).toMatchObject({ legal: true, holed: false, end: { x: 2, y: 0 } });
    expect(resolveShot(h, h.tee, NE, 2)).toMatchObject({ legal: true, end: { x: 4, y: 1 } });
  });

  it('rejects shots that leave the grid', () => {
    const h = holeFromAscii(['..o..', '.....', '....@']);
    expect(resolveShot(h, h.tee, N, 1)).toMatchObject({ legal: false, reason: 'offgrid' });
  });

  it('holes out on an exact landing or a 1-space overshoot, but flies over from further', () => {
    const h = holeFromAscii(['.', '.', '.', '@', '.', 'o']);
    expect(resolveShot(h, h.tee, N, 2).holed).toBe(true); // exact
    expect(resolveShot(h, h.tee, N, 3).holed).toBe(true); // overshoot by 1
    const over = resolveShot(h, h.tee, N, 4); // overshoot by 2: flies over
    expect(over).toMatchObject({ legal: true, holed: false, end: { x: 0, y: 1 } });
  });

  it('allows overshooting the cup by one even when that spot would be off the page', () => {
    const h = holeFromAscii(['@', '.', 'o']);
    expect(resolveShot(h, h.tee, N, 3)).toMatchObject({ legal: true, holed: true, end: { x: 0, y: 0 } });
  });

  it('lets the ball fly over water but never land in it', () => {
    const h = holeFromAscii(['.', '.', 'w', 'w', 'o', '@']);
    expect(resolveShot(h, h.tee, N, 3)).toMatchObject({ legal: true, end: { x: 0, y: 1 } });
    expect(resolveShot(h, h.tee, N, 2)).toMatchObject({ legal: false, reason: 'water' });
  });

  it('only flies over trees when hitting from the fairway', () => {
    const fromRough = holeFromAscii(['.', 'T', 'o', '@']);
    expect(resolveShot(fromRough, fromRough.tee, N, 2)).toMatchObject({ legal: false, reason: 'trees' });
    const fromFairway = holeFromAscii(['.', 'T', 'O', '@']);
    expect(resolveShot(fromFairway, fromFairway.tee, N, 2)).toMatchObject({ legal: true, end: { x: 0, y: 0 } });
    // Never land in trees.
    expect(resolveShot(fromFairway, fromFairway.tee, N, 1)).toMatchObject({ legal: false, reason: 'trees' });
  });

  it('rolls one space along a slope arrow', () => {
    const h = holeFromAscii(['...', '.>.', '...', '.o@']);
    const r = resolveShot(h, h.tee, N, 2);
    expect(r).toMatchObject({ legal: true, rolled: true, landing: { x: 1, y: 1 }, end: { x: 2, y: 1 } });
  });

  it('a slope can roll the ball into the cup', () => {
    const h = holeFromAscii(['.>@', '...', '.o.']);
    expect(resolveShot(h, h.tee, N, 2)).toMatchObject({ legal: true, holed: true, rolled: true, end: { x: 2, y: 0 } });
  });

  it('a slope pointing at water leaves the ball where it landed', () => {
    const h = holeFromAscii(['.>w', '...', '.o@']);
    expect(resolveShot(h, h.tee, N, 2)).toMatchObject({ legal: true, rolled: false, end: { x: 1, y: 0 } });
  });

  it('flying over the cup from far away does not count', () => {
    const h = holeFromAscii(['.', '.', '.', '@', '.', '.', 'o']);
    expect(resolveShot(h, h.tee, N, 6).holed).toBe(false);
  });
});

describe('dice distances', () => {
  const h = holeFromAscii(['fs.', '...', 'o.@']);
  it('adds 1 from the fairway and subtracts 1 from sand', () => {
    expect(diceDistance(h, { x: 0, y: 0 }, 4)).toBe(5);
    expect(diceDistance(h, { x: 1, y: 0 }, 4)).toBe(3);
    expect(diceDistance(h, { x: 2, y: 0 }, 4)).toBe(4);
    expect(diceDistance(h, { x: 1, y: 0 }, 1)).toBe(0); // only a putt is possible
  });
});

describe('legalMoves', () => {
  it('lists only legal directions', () => {
    const h = holeFromAscii(['TTT', 'ToT', 'TT@']);
    const moves = legalMoves(h, h.tee, 1);
    expect(moves.map((m) => m.dir)).toEqual([3]);
    expect(moves[0].result.holed).toBe(true);
    expect(legalMoves(h, h.tee, 0)).toEqual([]);
  });
});

describe('diceExpectedFromTee', () => {
  it('is one stroke when the cup is a putt away', () => {
    const h = holeFromAscii(['@', 'o']);
    expect(diceExpectedFromTee(h)).toBeCloseTo(1);
  });

  it('is infinite when the cup is unreachable', () => {
    const h = holeFromAscii(['@..', 'www', 'www', 'www', 'www', 'www', 'www', 'www', '.o.']);
    expect(diceExpectedFromTee(h)).toBe(Infinity);
  });
});
