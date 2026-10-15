import { describe, expect, it } from 'vitest';
import { COURSES, PROPER_HOLES } from '../src/engine/generator';
import { isLandable, movesForRoll, onGreen, resolveShot, rollSlopes } from '../src/engine/rules';
import { CALM, type Cell, type Dir, type P, type Wind } from '../src/engine/types';
import { autoHole, autoHoleMove, currentBall, currentHole, newGame, roll, skipToHole, type GameState } from '../src/game/game';
import { at, defined, dirs, testHole } from './helpers';

// A ball that comes to rest on a slope always rolls one dot downhill, however it got there (a hit, a putt, the wind,
// or an earlier slope), so slopes chain. A chain that would revisit a square stops where the loop is found.

const N: Dir = 0;
const E: Dir = 2;
const S: Dir = 4;
const SW: Dir = 5;
const W: Dir = 6;
const NW: Dir = 7;
const slope = (dir: Dir): Cell => ({ t: 'rough', slope: dir });
const wind = (strength: Wind['strength'], dir: Dir): Wind => ({ strength, dir });

describe('rollSlopes', () => {
  it('rolls one dot off a single slope, and not at all off flat ground', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '4,4': slope(E) });
    expect(rollSlopes(h, { x: 4, y: 4 })).toEqual({ path: [{ x: 5, y: 4 }], holed: false });
    expect(rollSlopes(h, { x: 3, y: 4 })).toEqual({ path: [], holed: false });
  });

  it('chains: a slope that rolls the ball onto another slope rolls it on again', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '5,6': slope(E), '6,6': slope(S), '6,7': slope(SW) });
    expect(rollSlopes(h, { x: 5, y: 6 }).path).toEqual([{ x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 8 }]);
  });

  it('stops a loop on the square where it is found: two slopes facing each other, and a three-slope ring', () => {
    const pair = testHole(9, 9, { x: 8, y: 0 }, { '5,6': slope(E), '6,6': slope(W) });
    expect(rollSlopes(pair, { x: 5, y: 6 })).toEqual({ path: [{ x: 6, y: 6 }], holed: false });
    const ring = testHole(9, 9, { x: 8, y: 0 }, { '2,2': slope(E), '3,2': slope(S), '3,3': slope(NW) });
    expect(rollSlopes(ring, { x: 2, y: 2 })).toEqual({ path: [{ x: 3, y: 2 }, { x: 3, y: 3 }], holed: false });
  });

  it('drops into the cup, and never rolls onto water, trees or off the page', () => {
    const cup = testHole(9, 9, { x: 7, y: 6 }, { '5,6': slope(E), '6,6': slope(E) });
    expect(rollSlopes(cup, { x: 5, y: 6 })).toEqual({ path: [{ x: 6, y: 6 }, { x: 7, y: 6 }], holed: true });
    const wet = testHole(9, 9, { x: 8, y: 0 }, { '5,6': slope(E), '6,6': slope(E), '7,6': { t: 'water' } });
    expect(rollSlopes(wet, { x: 5, y: 6 }).path).toEqual([{ x: 6, y: 6 }]);
    const edge = testHole(9, 9, { x: 8, y: 0 }, { '8,4': slope(E) });
    expect(rollSlopes(edge, { x: 8, y: 4 }).path).toEqual([]);
  });
});

describe('slopes in a shot', () => {
  it('a hit that lands on a slope chain ends at the bottom of the chain', () => {
    const h = testHole(12, 12, { x: 11, y: 0 }, { '5,6': slope(E), '6,6': slope(S), '6,7': slope(SW) });
    expect(resolveShot(h, { x: 1, y: 6 }, E, 4)).toEqual({
      legal: true,
      holed: false,
      landing: { x: 5, y: 6 },
      end: { x: 5, y: 8 },
      rolled: true,
      rolls: [{ x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 8 }],
    });
  });

  it('a hit onto a loop stops where the loop is found', () => {
    const h = testHole(12, 12, { x: 11, y: 0 }, { '5,6': slope(E), '6,6': slope(W) });
    expect(resolveShot(h, { x: 1, y: 6 }, E, 4).end).toEqual({ x: 6, y: 6 });
  });

  it('the wind pushes the ball onto a slope: it rolls on from there', () => {
    const h = testHole(12, 12, { x: 11, y: 0 }, { '4,4': slope(S) });
    const r = resolveShot(h, { x: 2, y: 8 }, N, 4, wind(2, E));
    expect(r).toMatchObject({ legal: true, holed: false, landing: { x: 2, y: 4 }, end: { x: 4, y: 5 }, blown: true });
  });

  it('slope, then wind, then a slope chain', () => {
    // Lands on (2,4) which rolls N to (2,3); the wind takes it 2 E to (4,3); slopes roll it S, S to (4,5).
    const h = testHole(12, 12, { x: 11, y: 0 }, { '2,4': slope(N), '4,3': slope(S), '4,4': slope(S) });
    expect(resolveShot(h, { x: 2, y: 8 }, N, 4, wind(2, E))).toMatchObject({ landing: { x: 2, y: 4 }, end: { x: 4, y: 5 }, rolled: true, blown: true });
  });

  it('the wind pushes the ball onto a slope loop: it stops where the loop is found', () => {
    const h = testHole(12, 12, { x: 11, y: 0 }, { '4,4': slope(E), '5,4': slope(W) });
    expect(resolveShot(h, { x: 3, y: 8 }, N, 4, wind(1, E)).end).toEqual({ x: 5, y: 4 });
  });

  it('the wind pushes the ball onto a slope that rolls it into the cup', () => {
    const h = testHole(12, 12, { x: 5, y: 4 }, { '4,4': slope(E) });
    expect(resolveShot(h, { x: 2, y: 8 }, N, 4, wind(2, E))).toMatchObject({ holed: true, end: { x: 5, y: 4 }, blown: true, rolled: true });
  });

  it('putts roll on slopes too (as they always have), and chain, but are never blown', () => {
    const h = testHole(12, 12, { x: 11, y: 0 }, { '5,6': slope(E), '6,6': slope(S) });
    const putt = defined(
      movesForRoll(h, { x: 4, y: 6 }, 1, wind(2, N)).find((m) => m.kind === 'putt' && m.dir === E),
      'putt east',
    );
    expect(putt.result).toMatchObject({ landing: { x: 5, y: 6 }, end: { x: 6, y: 7 }, rolled: true });
    expect(putt.result.blown).toBeUndefined();
  });
});

/** A hole, spot, roll and wind where the shot that plays itself only reaches the cup by rolling off a slope. */
function slopeHoleOut(preferWind: boolean): { g: GameState; pos: P; die: number; wind: Wind } | null {
  const winds: Wind[] = [CALM, ...dirs.flatMap((d) => [wind(1, d), wind(2, d)])];
  for (let c = 0; c < COURSES.length; c++)
    for (let n = 0; n < PROPER_HOLES; n++) {
      const g = newGame(c, ['A']);
      skipToHole(g, n);
      const hole = currentHole(g);
      for (let y = 0; y < hole.h; y++)
        for (let x = 0; x < hole.w; x++) {
          const pos = { x, y };
          if (!isLandable(hole, pos) || onGreen(hole, pos)) continue;
          for (const w of preferWind ? winds.slice(1) : [CALM])
            for (let die = 1; die <= 6; die++) {
              const moves = movesForRoll(hole, pos, die, w);
              const holing = moves.filter((m) => m.result.holed);
              if (holing.length > 0 && holing.every((m) => m.kind === 'hit' && m.result.rolled && (!preferWind || m.result.blown)))
                return { g, pos, die, wind: w };
            }
        }
    }
  return null;
}

describe('the auto shot through a slope', () => {
  for (const [label, preferWind] of [
    ['calm: a hit rolls off a slope into the cup', false],
    ['windy: the wind pushes a hit onto a slope that rolls it into the cup', true],
  ] as const)
    it(`plays itself (${label})`, () => {
      const s = defined(slopeHoleOut(preferWind), `a real hole where ${label}`);
      currentBall(s.g).pos = { ...s.pos };
      currentBall(s.g).strokes = 1;
      s.g.wind = s.wind;
      roll(s.g, s.die);
      const auto = defined(autoHoleMove(s.g), 'auto shot');
      expect(auto.result).toMatchObject({ holed: true, rolled: true });
      expect(auto.result.end).toEqual(currentHole(s.g).cup);
      const { record } = autoHole(s.g);
      expect(record.holed).toBe(true);
      expect(at(at(s.g.balls, 0).shots, 0).end).toEqual(currentHole(s.g).cup);
    });
});
