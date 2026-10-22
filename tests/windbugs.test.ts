import { describe, expect, it } from 'vitest';
import { cellAt, movesForRoll, resolveShot } from '../src/engine/rules';
import { type Dir, type Wind } from '../src/engine/types';
import { autoHoleMove, availableMoves, currentBall, currentHole, newGame, roll, shoot, skipToHole, type GameState } from '../src/game/game';
import { defined, testHole } from './helpers';

// Derek's production bugs, set up exactly as in his phone screenshots: b2c6d1a
// (.golf-briefs/wind-shots/bug-ne1-hole3.png and bug-sw2-hole4.png, Dune Ridge = course index 2) and the wind
// blowing a hit into trees (.golf-briefs/wind-trees/shots/bug-w1-lakeside1.png, Lakeside = course index 3).

const N: Dir = 0;
const NE: Dir = 1;
const E: Dir = 2;
const SE: Dir = 3;
const S: Dir = 4;
const SW: Dir = 5;
const W: Dir = 6;
const NW: Dir = 7;

/** Course `course` (Dune Ridge by default) `hole` (1-based), one player, the ball at `pos` after `strokes`, this wind,
 * the die showing `die`. */
function situation(hole: number, pos: { x: number; y: number }, strokes: number, wind: Wind, die: number, course = 2): GameState {
  const g = newGame(course, ['Player 1']);
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
      // SE lands on (12,8) on the east edge; the full NE 1 push takes it to (13,7), off the page: not offered.
    });
    expect(availableMoves(g).some((m) => m.kind === 'hit' && m.dir === SE)).toBe(false);
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
    // Calm, it rests on the slope and rolls N.
    expect(resolveShot(h, { x: 4, y: 8 }, N, 2)).toMatchObject({ end: { x: 4, y: 5 }, rolled: true });
    // Water at (5,5) never stops the push: the wind would leave the ball in it, so the shot is not offered.
    const wet = testHole(9, 9, { x: 8, y: 0 }, { '4,6': { t: 'rough', slope: N }, '5,5': { t: 'water' } });
    expect(resolveShot(wet, { x: 4, y: 8 }, N, 2, { strength: 1, dir: NE })).toMatchObject({ legal: false, reason: 'water' });
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
    // Only N and E finish on the page. W and NW land on the west edge and the full SW 2 push takes them off it (see
    // below); NE is blown back on into the water at (12,10); SE, S and SW never get back on it.
    expect(hits(g)).toEqual({ [N]: { x: 5, y: 10 }, [E]: { x: 12, y: 17 } });
    const { record } = shoot(g, E, 7);
    expect(record.end).toEqual({ x: 12, y: 17 });
  });

  it('the W hit of 7 is not offered: the full SW 2 push takes it from (0,15) off the page, no clamping at the edge', () => {
    const g = situation(4, { x: 7, y: 15 }, 0, { strength: 2, dir: SW }, 6);
    const hole = currentHole(g);
    // Calm, the W hit of 7 lands on (0,15) on the edge and is fine.
    expect(resolveShot(hole, hole.tee, W, 7)).toMatchObject({ legal: true, end: { x: 0, y: 15 } });
    // SW 2 moves it 2 west and 2 south, to (-2,17): off the page, so the shot is illegal and never offered.
    expect(resolveShot(hole, hole.tee, W, 7, { strength: 2, dir: SW })).toMatchObject({ legal: false, reason: 'offgrid' });
    expect(availableMoves(g).some((m) => m.dir === W && m.kind === 'hit')).toBe(false);
    expect(autoHoleMove(g)).toBeNull();
  });

  it('the wind applies its full push: from off the page it must finish on the page, and not in water', () => {
    const h = testHole(9, 9, { x: 0, y: 0 }, { '8,5': { t: 'water' } });
    // Lands 2 off the east edge at (10,4); W 2 brings it back to (8,4).
    expect(resolveShot(h, { x: 4, y: 4 }, E, 6, { strength: 2, dir: W })).toMatchObject({ legal: true, landing: { x: 10, y: 4 }, end: { x: 8, y: 4 } });
    // Lands 1 off at (9,4); the full W 2 push takes it to (7,4).
    expect(resolveShot(h, { x: 4, y: 4 }, E, 5, { strength: 2, dir: W }).end).toEqual({ x: 7, y: 4 });
    // On the page, a push towards the edge goes its full length or off the page: never stops at the edge.
    expect(resolveShot(h, { x: 4, y: 4 }, E, 3, { strength: 2, dir: E })).toMatchObject({ legal: false, reason: 'offgrid' });
    expect(resolveShot(h, { x: 4, y: 4 }, E, 2, { strength: 2, dir: E })).toMatchObject({ legal: true, end: { x: 8, y: 4 } });
    // 3 off the page with a push of 2: never gets back.
    expect(resolveShot(h, { x: 4, y: 4 }, E, 7, { strength: 2, dir: W }).legal).toBe(false);
    // Calm: off the page is off the page.
    expect(resolveShot(h, { x: 4, y: 4 }, E, 5).legal).toBe(false);
    // Only the dot it ends on counts: blown back from (9,3), W 1 leaves it in the water at (8,3), so the shot is not
    // offered; W 2 carries it over that water to (7,3).
    const wet = testHole(9, 9, { x: 0, y: 0 }, { '8,3': { t: 'water' } });
    expect(resolveShot(wet, { x: 4, y: 3 }, E, 5, { strength: 1, dir: W })).toMatchObject({ legal: false, reason: 'water' });
    expect(resolveShot(wet, { x: 4, y: 3 }, E, 5, { strength: 2, dir: W })).toMatchObject({ legal: true, end: { x: 7, y: 3 } });
  });

  it('a roll the wind brings back from off the page into the cup plays itself', () => {
    const h = testHole(9, 9, { x: 8, y: 4 });
    // E 7 from (3,4) flies over the cup at (8,4) (2 short of touchdown) and lands off the page at (10,4).
    expect(resolveShot(h, { x: 3, y: 4 }, E, 7)).toMatchObject({ legal: false });
    expect(resolveShot(h, { x: 3, y: 4 }, E, 7, { strength: 2, dir: W })).toMatchObject({ legal: true, holed: true, end: { x: 8, y: 4 } });
  });
});

describe('bug 3: the wind cannot blow a hit into trees (Lakeside hole 1, wind W 1, rolled 4 = hit 5 from the tee)', () => {
  const tee = { x: 10, y: 14 };
  const lakeside = () => situation(1, tee, 0, { strength: 1, dir: W }, 4, 3);

  it('reproduces the screenshot: the tee on the fairway, the N hit of 5 lands on (10,9) with trees at (9,9)', () => {
    const hole = currentHole(lakeside());
    expect(hole.tee).toEqual(tee);
    expect(cellAt(hole, tee).t).toBe('fairway');
    expect(cellAt(hole, { x: 10, y: 9 }).t).toBe('fairway');
    expect(cellAt(hole, { x: 9, y: 9 }).t).toBe('tree');
    // Calm, the N hit of 5 is fine.
    expect(resolveShot(hole, tee, N, 5)).toMatchObject({ legal: true, end: { x: 10, y: 9 } });
  });

  it('the N hit is not offered: W 1 would blow it from (10,9) into the trees at (9,9)', () => {
    const g = lakeside();
    expect(resolveShot(currentHole(g), tee, N, 5, { strength: 1, dir: W })).toMatchObject({ legal: false, reason: 'trees' });
    expect(availableMoves(g).some((m) => m.kind === 'hit' && m.dir === N)).toBe(false);
    // The other hits are still offered, each pushed its full dot west.
    expect(hits(g)).toEqual({
      [S]: { x: 9, y: 19 },
      [SW]: { x: 4, y: 19 },
      [W]: { x: 4, y: 14 },
      [NW]: { x: 4, y: 9 },
    });
  });
});

describe('bug 4: a touchdown in the trees the wind carries the ball on from (issue 1: Thunder Peaks hole 11, wind NE 1, rolled 2 = hit 3 from the tee)', () => {
  const tee = { x: 6, y: 11 };
  const peaks = () => situation(11, tee, 0, { strength: 1, dir: NE }, 2, 4);

  it('reproduces the screenshot: the tee on the fairway of a par 3, the NE hit of 3 aiming at the trees at (9,8)', () => {
    const g = peaks();
    const hole = currentHole(g);
    expect(hole.tee).toEqual(tee);
    expect(hole.par).toBe(3);
    expect(currentBall(g).pos).toEqual(tee);
    expect(cellAt(hole, tee).t).toBe('fairway');
    expect(cellAt(hole, { x: 9, y: 8 }).t).toBe('tree');
    expect(cellAt(hole, { x: 10, y: 7 }).t).toBe('fairway');
    // Calm, the ball comes down in those trees, so the shot is not offered.
    expect(resolveShot(hole, tee, NE, 3)).toMatchObject({ legal: false, reason: 'trees' });
  });

  it('offers the NE hit: the ball is still in the air, and NE 1 carries it over those trees onto the fairway at (10,7)', () => {
    const g = peaks();
    expect(resolveShot(currentHole(g), tee, NE, 3, { strength: 1, dir: NE })).toMatchObject({
      legal: true,
      holed: false,
      landing: { x: 9, y: 8 },
      end: { x: 10, y: 7 },
      blown: true,
    });
    expect(availableMoves(g).some((m) => m.kind === 'hit' && m.dir === NE)).toBe(true);
    const { record } = shoot(g, NE, 3);
    expect(record.end).toEqual({ x: 10, y: 7 });
    expect(currentBall(g).pos).toEqual({ x: 10, y: 7 });
  });

  it('the SE hit stays unoffered: NE 1 takes it from the trees at (9,14) into more trees at (10,13)', () => {
    const g = peaks();
    const hole = currentHole(g);
    expect(cellAt(hole, { x: 9, y: 14 }).t).toBe('tree');
    expect(cellAt(hole, { x: 10, y: 13 }).t).toBe('tree');
    expect(resolveShot(hole, tee, SE, 3, { strength: 1, dir: NE })).toMatchObject({ legal: false, reason: 'trees' });
    expect(availableMoves(g).some((m) => m.kind === 'hit' && m.dir === SE)).toBe(false);
  });

  it('every other hit is unchanged: the seven dots of the screenshot, each pushed one dot NE', () => {
    expect(hits(peaks())).toEqual({
      [N]: { x: 7, y: 7 },
      [NE]: { x: 10, y: 7 },
      [E]: { x: 10, y: 10 },
      [S]: { x: 7, y: 12 },
      [SW]: { x: 4, y: 13 },
      [W]: { x: 4, y: 10 },
      [NW]: { x: 4, y: 7 },
    });
  });
});

describe('the aim is one more dot flown over when the wind carries the ball on (issue 1)', () => {
  // 11x11 of rough with the cup out of the way in the corner; every shot below is played east from column 2.
  const h = testHole(11, 11, { x: 0, y: 10 }, {
    '2,0': { t: 'fairway' },
    '2,3': { t: 'fairway' },
    '2,5': { t: 'fairway' },
    '2,9': { t: 'fairway' },
    '5,0': { t: 'tree' },
    '5,3': { t: 'water' },
    '5,4': { t: 'tree' },
    '5,5': { t: 'tree' },
    '5,6': { t: 'water' },
    '5,7': { t: 'tree' },
    '5,9': { t: 'tree' },
    '6,8': { t: 'rough', slope: W },
    '6,9': { t: 'rough', slope: N },
  });

  it('carries a hit on from trees onto the dot it ends on, when it was hit from the fairway', () => {
    expect(resolveShot(h, { x: 2, y: 5 }, E, 3, { strength: 1, dir: E })).toMatchObject({
      legal: true,
      holed: false,
      landing: { x: 5, y: 5 },
      end: { x: 6, y: 5 },
      blown: true,
      rolled: false,
    });
  });

  it('still blocks those trees when the shot was not hit from the fairway', () => {
    // Same geometry one row down, hit from rough: the ball may not fly over trees at all, aim or not.
    expect(resolveShot(h, { x: 2, y: 7 }, E, 3, { strength: 1, dir: E })).toMatchObject({ legal: false, reason: 'trees' });
    // A tree on the way, short of the aim, blocks a rough lie exactly as before.
    expect(resolveShot(h, { x: 2, y: 7 }, E, 4, { strength: 1, dir: E })).toMatchObject({ legal: false, reason: 'trees' });
  });

  it('carries a hit on from water from any lie: water is always flown over', () => {
    expect(resolveShot(h, { x: 2, y: 3 }, E, 3, { strength: 1, dir: E })).toMatchObject({ legal: true, landing: { x: 5, y: 3 }, end: { x: 6, y: 3 }, blown: true });
    const rough = testHole(11, 11, { x: 0, y: 10 }, { '5,3': { t: 'water' } });
    expect(resolveShot(rough, { x: 2, y: 3 }, E, 3, { strength: 1, dir: E })).toMatchObject({ legal: true, end: { x: 6, y: 3 } });
  });

  it('is still judged by the dot it ends on: into more trees, into water, or off the board', () => {
    expect(resolveShot(h, { x: 2, y: 5 }, E, 3, { strength: 1, dir: N })).toMatchObject({ legal: false, reason: 'trees' });
    expect(resolveShot(h, { x: 2, y: 5 }, E, 3, { strength: 1, dir: S })).toMatchObject({ legal: false, reason: 'water' });
    expect(resolveShot(h, { x: 2, y: 0 }, E, 3, { strength: 1, dir: N })).toMatchObject({ legal: false, reason: 'offgrid' });
  });

  it('lets slopes chain from where the ball rests after being carried on', () => {
    // Aims at the trees at (5,9); E 1 carries it to the N slope at (6,9), which rolls it to the W slope at (6,8),
    // which rolls it to (5,8), where it stops.
    expect(resolveShot(h, { x: 2, y: 9 }, E, 3, { strength: 1, dir: E })).toMatchObject({
      legal: true,
      holed: false,
      landing: { x: 5, y: 9 },
      end: { x: 5, y: 8 },
      blown: true,
      rolled: true,
      rolls: [{ x: 6, y: 8 }, { x: 5, y: 8 }],
    });
  });

  it('holes the ball when the dot it is carried on to is the cup', () => {
    const wet = testHole(11, 11, { x: 6, y: 3 }, { '5,3': { t: 'water' } });
    expect(resolveShot(wet, { x: 2, y: 3 }, E, 3, { strength: 1, dir: E })).toMatchObject({ legal: true, holed: true, end: { x: 6, y: 3 } });
  });

  it('changes nothing when the hole is calm: the ball comes down on the aim and stays there', () => {
    expect(resolveShot(h, { x: 2, y: 5 }, E, 3)).toMatchObject({ legal: false, reason: 'trees' });
    expect(resolveShot(h, { x: 2, y: 3 }, E, 3)).toMatchObject({ legal: false, reason: 'water' });
    expect(resolveShot(h, { x: 2, y: 9 }, E, 3)).toMatchObject({ legal: false, reason: 'trees' });
  });

  it('never carries a putt on: putts are played calm, so they still may not finish in water or trees', () => {
    for (const from of [{ x: 4, y: 5 }, { x: 4, y: 3 }, { x: 4, y: 6 }])
      for (let r = 1; r <= 6; r++) {
        const putts = movesForRoll(h, from, r, { strength: 2, dir: E }).filter((m) => m.kind === 'putt');
        expect(putts).toEqual(movesForRoll(h, from, r).filter((m) => m.kind === 'putt'));
        expect(putts.some((m) => m.dir === E)).toBe(false);
      }
  });
});

describe('a wind push is judged only by the dot it ends on', () => {
  const h = testHole(9, 9, { x: 0, y: 0 }, { '5,4': { t: 'tree' }, '6,4': { t: 'water' }, '8,2': { t: 'tree' }, '4,6': { t: 'tree' }, '4,7': { t: 'fairway' } });

  it('a push ending on water makes the hit illegal', () => {
    // Lands on (4,4); E 2 carries it over the trees at (5,4) onto the water at (6,4).
    expect(resolveShot(h, { x: 1, y: 4 }, E, 3, { strength: 2, dir: E })).toMatchObject({ legal: false, reason: 'water' });
  });

  it('a push ending on trees makes the hit illegal', () => {
    // Lands on (4,4); E 1 ends on the trees at (5,4).
    expect(resolveShot(h, { x: 1, y: 4 }, E, 3, { strength: 1, dir: E })).toMatchObject({ legal: false, reason: 'trees' });
  });

  it('a ball blown back on from off the page onto trees is not a shot', () => {
    // E 5 from (4,1) lands off the page at (9,1); SW 1 brings it back onto the trees at (8,2).
    expect(resolveShot(h, { x: 4, y: 1 }, E, 5, { strength: 1, dir: SW })).toMatchObject({ legal: false, reason: 'trees' });
    // SW 2 carries it over those trees to (7,3): fine.
    expect(resolveShot(h, { x: 4, y: 1 }, E, 5, { strength: 2, dir: SW })).toMatchObject({ legal: true, end: { x: 7, y: 3 } });
  });

  it('a push that passes over trees and ends on the fairway is legal', () => {
    // Lands on (4,5); S 2 carries it over the trees at (4,6) to the fairway at (4,7).
    expect(resolveShot(h, { x: 4, y: 2 }, S, 3, { strength: 2, dir: S })).toMatchObject({ legal: true, landing: { x: 4, y: 5 }, end: { x: 4, y: 7 }, blown: true });
  });
});
