import { describe, expect, it } from 'vitest';
import { cellAt, resolveShot } from '../src/engine/rules';
import { type Dir, type Wind } from '../src/engine/types';
import { availableMoves, currentBall, currentHole, newGame, roll, shoot, skipToHole, type GameState } from '../src/game/game';
import { defined, testHole } from './helpers';

// Derek's two production bugs (b2c6d1a), set up exactly as in his phone screenshots
// (.golf-briefs/wind-shots/bug-ne1-hole3.png and bug-sw2-hole4.png). Dune Ridge is course index 2.

const N: Dir = 0;
const NE: Dir = 1;
const E: Dir = 2;
const SE: Dir = 3;
const S: Dir = 4;
const SW: Dir = 5;
const W: Dir = 6;

/** Dune Ridge `hole` (1-based), one player, the ball at `pos` after `strokes`, this wind, the die showing `die`. */
function situation(hole: number, pos: { x: number; y: number }, strokes: number, wind: Wind, die: number): GameState {
  const g = newGame(2, ['Player 1']);
  skipToHole(g, hole - 1);
  currentBall(g).pos = { ...pos };
  currentBall(g).strokes = strokes;
  g.wind = wind;
  roll(g, die);
  return g;
}

const hits = (g: GameState) =>
  Object.fromEntries(availableMoves(g).filter((m) => m.kind === 'hit').map((m) => [m.dir, m.result.end]));

describe('bug 1: wind first, then slopes (Dune Ridge hole 3, wind NE 1, rolled 5)', () => {
  const ball = { x: 7, y: 3 };

  it('reproduces the screenshot: the S hit lands on a N slope at (7,8) in the rough', () => {
    const g = situation(3, ball, 1, { strength: 1, dir: NE }, 5);
    const hole = currentHole(g);
    expect(cellAt(hole, ball).t).toBe('rough');
    expect(cellAt(hole, { x: 7, y: 8 }).slope).toBe(N);
  });

  it('the wind moves the ball off that slope, so it never rolls: the S hit ends on (8,7), not (8,6)', () => {
    const g = situation(3, ball, 1, { strength: 1, dir: NE }, 5);
    expect(hits(g)).toEqual({
      [W]: { x: 3, y: 2 },
      [SW]: { x: 3, y: 7 },
      [S]: { x: 8, y: 7 },
      [SE]: { x: 12, y: 8 }, // pushed NE off the page at once: stays on its landing
    });
    const s = defined(availableMoves(g).find((m) => m.kind === 'hit' && m.dir === S), 'S hit');
    expect(s.result).toMatchObject({ landing: { x: 7, y: 8 }, end: { x: 8, y: 7 }, rolled: false, blown: true });
    const { record } = shoot(g, S, 5);
    expect(record.end).toEqual({ x: 8, y: 7 });
    expect(currentBall(g).pos).toEqual({ x: 8, y: 7 });
  });

  it('a slope on the landing square still rolls the ball when the wind leaves it there, and always for putts', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '4,6': { t: 'rough', slope: N } });
    // Lands on the slope (4,6); NE 1 blows it to (5,5): the slope never touches it.
    expect(resolveShot(h, { x: 4, y: 8 }, N, 2, { strength: 1, dir: NE }).end).toEqual({ x: 5, y: 5 });
    // Water at (5,5) stops the push, so it rests on the slope and rolls N.
    const blocked = testHole(9, 9, { x: 8, y: 0 }, { '4,6': { t: 'rough', slope: N }, '5,5': { t: 'water' } });
    expect(resolveShot(blocked, { x: 4, y: 8 }, N, 2, { strength: 1, dir: NE })).toMatchObject({ end: { x: 4, y: 5 }, rolled: true });
    expect(resolveShot(h, { x: 4, y: 7 }, N, 1).end).toEqual({ x: 4, y: 5 });
  });
});

describe('bug 2: shots judged by where they finish (Dune Ridge hole 4, wind SW 2, rolled 6 = hit 7)', () => {
  it('reproduces the screenshot: the tee at (7,15) on the fairway, 7 dots east is off the page', () => {
    const g = situation(4, { x: 7, y: 15 }, 0, { strength: 2, dir: SW }, 6);
    const hole = currentHole(g);
    expect(currentBall(g).pos).toEqual(hole.tee);
    expect(hole.tee).toEqual({ x: 7, y: 15 });
    expect(cellAt(hole, hole.tee).t).toBe('fairway');
    expect(hole.w).toBe(13);
  });

  it('offers the E hit: the wind brings it back on the page to (12,17)', () => {
    const g = situation(4, { x: 7, y: 15 }, 0, { strength: 2, dir: SW }, 6);
    const e = defined(availableMoves(g).find((m) => m.kind === 'hit' && m.dir === E), 'E hit');
    expect(e.result).toMatchObject({ legal: true, holed: false, landing: { x: 14, y: 15 }, end: { x: 12, y: 17 }, blown: true });
    // As in the screenshot N, W and NW stay on the page; NE comes back onto water (12,10) with no push left, and SE,
    // S and SW never get back on the page: none of those is offered.
    expect(hits(g)).toEqual({ [N]: { x: 5, y: 10 }, [E]: { x: 12, y: 17 }, [W]: { x: 0, y: 15 }, 7: { x: 0, y: 8 } });
    const { record } = shoot(g, E, 7);
    expect(record.end).toEqual({ x: 12, y: 17 });
  });

  it('a push from off the page stops on the first legal square on it, or the shot is not offered', () => {
    const h = testHole(9, 9, { x: 0, y: 0 }, { '8,5': { t: 'water' } });
    // Lands 2 off the east edge at (10,4); W 2 brings it back to (8,4).
    expect(resolveShot(h, { x: 4, y: 4 }, E, 6, { strength: 2, dir: W })).toMatchObject({ legal: true, landing: { x: 10, y: 4 }, end: { x: 8, y: 4 } });
    // Lands 1 off at (9,4); W 2 stops on (8,4), the first legal square, not (7,4).
    expect(resolveShot(h, { x: 4, y: 4 }, E, 5, { strength: 2, dir: W }).end).toEqual({ x: 8, y: 4 });
    // 3 off the page with a push of 2: never gets back.
    expect(resolveShot(h, { x: 4, y: 4 }, E, 7, { strength: 2, dir: W }).legal).toBe(false);
    // Calm: off the page is off the page.
    expect(resolveShot(h, { x: 4, y: 4 }, E, 5).legal).toBe(false);
    // Pushed back onto water: carried on to the next legal square when the push allows.
    const wet = testHole(9, 9, { x: 0, y: 0 }, { '8,3': { t: 'water' } });
    expect(resolveShot(wet, { x: 4, y: 3 }, E, 5, { strength: 2, dir: W })).toMatchObject({ legal: true, end: { x: 7, y: 3 } });
    expect(resolveShot(wet, { x: 4, y: 3 }, E, 5, { strength: 1, dir: W }).legal).toBe(false);
  });

  it('a roll the wind brings back from off the page into the cup plays itself', () => {
    const h = testHole(9, 9, { x: 8, y: 4 });
    // E 7 from (3,4) flies over the cup at (8,4) (2 short of touchdown) and lands off the page at (10,4).
    expect(resolveShot(h, { x: 3, y: 4 }, E, 7)).toMatchObject({ legal: false });
    expect(resolveShot(h, { x: 3, y: 4 }, E, 7, { strength: 2, dir: W })).toMatchObject({ legal: true, holed: true, end: { x: 8, y: 4 } });
  });
});
