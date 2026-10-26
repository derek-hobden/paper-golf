import { describe, expect, it } from 'vitest';
import { liftLine, liftTag, liftWords, sharedLift, shiftOf } from '../src/engine/elevation';
import {
  climbFor,
  elevatedDistance,
  heightAt,
  hitMoves,
  legalMoves,
  movesForRoll,
  puttMoves,
  resolveShot,
  rollSlopes,
} from '../src/engine/rules';
import { CALM, type Cell, type Dir, type Hole, type P, type Wind } from '../src/engine/types';
import { at, defined, dirs, testHole } from './helpers';

// Derek's elevation rule (26 Oct 2026), stated once and checked against the engine:
//
// Every cell has a height of −1, 0 or +1, 0 by default. A hit of today's distance in a direction instead carries
// that distance plus (the height it is played from − the height of the dot it would have come down on), never below
// 1. Only that one dot's height counts: the adjusted landing is never looked up again, so there is no second pass
// and no chain. It is worked out per direction, so the markers of one roll can sit at different distances. It is
// applied before the wind and the slopes, which then work exactly as they always have, and putts are never
// affected — the putting rules near the cup are untouched.

const N: Dir = 0;
const E: Dir = 2;
const S: Dir = 4;
const W: Dir = 6;

/** A 9x9 rough hole with the cup out of the way, cells overridden by "x,y". */
function page(overrides: Record<string, Cell> = {}, cup: P = { x: 8, y: 0 }): Hole {
  return testHole(9, 9, cup, overrides);
}

/** `n` cells of rough at height `e`, in a row from (x, y) eastwards. */
function ridge(x: number, y: number, n: number, e: -1 | 1): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (let i = 0; i < n; i++) out[`${String(x + i)},${String(y)}`] = { t: 'rough', e };
  return out;
}

describe('heights on the page', () => {
  it('is level everywhere by default, and off the page', () => {
    const hole = page();
    for (let y = 0; y < hole.h; y++) for (let x = 0; x < hole.w; x++) expect(heightAt(hole, { x, y })).toBe(0);
    expect(heightAt(hole, { x: -1, y: 4 })).toBe(0);
    expect(heightAt(hole, { x: 4, y: 99 })).toBe(0);
  });

  it('reads a plateau and a dip', () => {
    const hole = page({ '4,4': { t: 'rough', e: 1 }, '4,5': { t: 'sand', e: -1 } });
    expect(heightAt(hole, { x: 4, y: 4 })).toBe(1);
    expect(heightAt(hole, { x: 4, y: 5 })).toBe(-1);
    expect(heightAt(hole, { x: 3, y: 4 })).toBe(0);
  });

  it('is the climb from the lie to where the shot would land, and the distance it leaves', () => {
    // A plateau at (4,4), a dip at (6,4); the ball on level ground at (2,4).
    const hole = page({ '4,4': { t: 'rough', e: 1 }, '6,4': { t: 'rough', e: -1 } });
    const from = { x: 2, y: 4 };
    expect(climbFor(hole, from, E, 2)).toBe(1);
    expect(climbFor(hole, from, E, 4)).toBe(-1);
    expect(climbFor(hole, from, E, 3)).toBe(0);
    expect(climbFor(hole, from, W, 2)).toBe(0);
    // Uphill carries less, downhill more, never below one space, and the climb only ever moves it by itself.
    expect(elevatedDistance(4, 1)).toBe(3);
    expect(elevatedDistance(4, -1)).toBe(5);
    expect(elevatedDistance(4, -2)).toBe(6);
    expect(elevatedDistance(4, 2)).toBe(2);
    expect(elevatedDistance(2, 2)).toBe(1);
    expect(elevatedDistance(1, 2)).toBe(1);
    expect(elevatedDistance(3, 0)).toBe(3);
  });
});

describe('a hit over a change of height', () => {
  it('goes one space shorter uphill and one longer downhill', () => {
    const hole = page({ ...ridge(5, 4, 4, 1) });
    const from = { x: 2, y: 4 };
    // Level ground at (2,4), the plateau from x=5: a 3-space hit would come down on (5,4), which is +1, so it
    // carries 2 and stops at (4,4).
    const up = defined(hitMoves(hole, from, 3).find((m) => m.dir === E), 'the uphill hit');
    expect(up.dist).toBe(2);
    expect(up.result.end).toEqual({ x: 4, y: 4 });
    expect(up.climb).toBe(1);
    expect(up.level).toEqual({ x: 5, y: 4 });
    expect(shiftOf(from, up)).toBe(-1);
    // From the plateau itself, a hit back onto level ground carries one more.
    const down = defined(hitMoves(hole, { x: 6, y: 4 }, 3).find((m) => m.dir === W), 'the downhill hit');
    expect(down.dist).toBe(4);
    expect(down.result.end).toEqual({ x: 2, y: 4 });
    expect(down.climb).toBe(-1);
    expect(shiftOf({ x: 6, y: 4 }, down)).toBe(1);
  });

  it('goes two spaces further from a plateau down into a dip, and two shorter the other way', () => {
    const hole = page({ ...ridge(0, 4, 3, 1), ...ridge(5, 4, 4, -1) });
    const from = { x: 1, y: 4 };
    const down = defined(hitMoves(hole, from, 4).find((m) => m.dir === E), 'the two-level hit');
    expect(down.climb).toBe(-2);
    expect(down.dist).toBe(6);
    expect(down.result.end).toEqual({ x: 7, y: 4 });
    expect(shiftOf(from, down)).toBe(2);
    // Back the other way from the dip: a 5-space hit onto the plateau at (2,4) carries 3 and stops at (4,4).
    const up = defined(hitMoves(hole, { x: 7, y: 4 }, 5).find((m) => m.dir === W), 'the two-level hit back');
    expect(up.climb).toBe(2);
    expect(up.dist).toBe(3);
    expect(up.result.end).toEqual({ x: 4, y: 4 });
    expect(shiftOf({ x: 7, y: 4 }, up)).toBe(-2);
  });

  it('never carries less than one space, however far uphill', () => {
    const hole = page({ ...ridge(0, 4, 3, -1), ...ridge(3, 4, 6, 1) });
    const from = { x: 1, y: 4 };
    const up = defined(hitMoves(hole, from, 2).find((m) => m.dir === E), 'the clamped hit');
    expect(up.climb).toBe(2);
    expect(up.dist).toBe(1);
    expect(up.result.end).toEqual({ x: 2, y: 4 });
    // The tag says what really happened: a 2-space hit can only lose one space.
    expect(shiftOf(from, up)).toBe(-1);
  });

  it('reads only the dot it would have landed on: no second pass down the adjusted landing', () => {
    // Hitting 3 east from (2,4): (5,4) is +1, so it carries 2 onto (4,4) — which is a dip. A second pass would read
    // that −1 and send it further; it must not.
    const hole = page({ '4,4': { t: 'rough', e: -1 }, '5,4': { t: 'rough', e: 1 } });
    const move = defined(hitMoves(hole, { x: 2, y: 4 }, 3).find((m) => m.dir === E), 'the hit');
    expect(move.dist).toBe(2);
    expect(move.result.end).toEqual({ x: 4, y: 4 });
  });

  it('is worked out per direction, so one roll can offer markers at different distances', () => {
    // The ball on a plateau that reaches west: east drops to level ground (one longer), west stays up (unchanged),
    // north is a dip two levels down (two longer).
    const hole = page({
      ...ridge(0, 4, 5, 1),
      '4,2': { t: 'rough', e: -1 },
    });
    const from = { x: 4, y: 4 };
    const moves = hitMoves(hole, from, 2);
    const by = (dir: Dir) => defined(moves.find((m) => m.dir === dir), `the hit ${String(dir)}`);
    expect(by(E).dist).toBe(3);
    expect(by(W).dist).toBe(2);
    expect(by(W).climb).toBeUndefined();
    expect(by(N).dist).toBe(4);
    expect(by(N).climb).toBe(-2);
    expect(new Set(moves.map((m) => m.dist)).size).toBeGreaterThan(1);
  });

  it('holes out when the adjusted path passes the cup', () => {
    // The cup four east of the ball; a 3-space hit downhill carries 4 and drops.
    const hole = page({ ...ridge(3, 4, 5, -1) }, { x: 6, y: 4 });
    const move = defined(hitMoves(hole, { x: 2, y: 4 }, 3).find((m) => m.dir === E), 'the hit');
    expect(move.dist).toBe(4);
    expect(move.result.holed).toBe(true);
    // And the adjusted path may overshoot the cup by one, as any path may.
    const over = page({ ...ridge(3, 4, 5, -1) }, { x: 5, y: 4 });
    const m2 = defined(hitMoves(over, { x: 2, y: 4 }, 3).find((m) => m.dir === E), 'the overshooting hit');
    expect(m2.dist).toBe(4);
    expect(m2.result.holed).toBe(true);
  });

  it('is judged on the adjusted landing: a hit shortened into water or trees is not offered', () => {
    const water = page({ '4,4': { t: 'water' }, '5,4': { t: 'rough', e: 1 } });
    expect(hitMoves(water, { x: 2, y: 4 }, 3).some((m) => m.dir === E)).toBe(false);
    // Lengthened off the page: a 3-space hit downhill carries 4, past the edge.
    const edge = page({ ...ridge(6, 4, 3, -1) });
    expect(hitMoves(edge, { x: 5, y: 4 }, 3).some((m) => m.dir === E)).toBe(false);
  });

  it('is applied before the wind, which then pushes its full vector from the adjusted landing', () => {
    const hole = page({ ...ridge(5, 4, 4, 1) });
    const from = { x: 2, y: 4 };
    const wind: Wind = { strength: 1, dir: S };
    const move = defined(hitMoves(hole, from, 3, wind).find((m) => m.dir === E), 'the hit');
    // Elevation shortens it to 2 (touchdown (4,4)); the wind then blows it one dot south, as it always would.
    expect(move.dist).toBe(2);
    expect(move.result.landing).toEqual({ x: 4, y: 4 });
    expect(move.result.end).toEqual({ x: 4, y: 5 });
    expect(move.result.blown).toBe(true);
    expect(move.result).toEqual(resolveShot(hole, from, E, 2, wind));
  });

  it('is applied before the slopes, which then roll the ball on from where it rests', () => {
    const hole = page({ ...ridge(5, 4, 4, 1), '4,4': { t: 'rough', slope: S } });
    const move = defined(hitMoves(hole, { x: 2, y: 4 }, 3).find((m) => m.dir === E), 'the hit');
    expect(move.result.landing).toEqual({ x: 4, y: 4 });
    expect(move.result.rolled).toBe(true);
    expect(move.result.end).toEqual({ x: 4, y: 5 });
    // The same chain a slope rolls from that dot, unchanged.
    expect(rollSlopes(hole, { x: 4, y: 4 }).path).toEqual([{ x: 4, y: 5 }]);
  });

  it('climbs after the lie and the rain have set the distance, not before', () => {
    const hole = page({ ...ridge(4, 4, 5, 1) });
    const from = { x: 2, y: 4 };
    // A roll of 3 from the rough carries 3 in the dry: the aim (5,4) is +1, so it plays 2.
    expect(defined(movesForRoll(hole, from, 3).find((m) => m.kind === 'hit' && m.dir === E), 'the dry hit').dist).toBe(2);
    // In the rain the heavy air takes its space first (3 → 2), and the climb then leaves one.
    const wet = movesForRoll(hole, from, 3, CALM, true);
    const hit = defined(
      wet.find((m) => m.kind === 'hit' && m.dir === E),
      'the rainy uphill hit',
    );
    expect(hit.dist).toBe(1);
    expect(hit.climb).toBe(1);
    // A hit the climb brings down to one space is still a hit, not the one-space putt: both are on offer.
    expect(wet.filter((m) => m.dir === E && m.dist === 1).map((m) => m.kind).sort()).toEqual(['hit', 'putt']);
  });

  it('leaves putts alone: the 1-dot putt and the longer putts on the green never climb', () => {
    const hole = page({ ...ridge(3, 4, 5, 1) }, { x: 6, y: 4 });
    // A putt is a straight shot of exactly its own length whatever the ground does.
    for (const dist of [1, 2, 3]) {
      for (const m of puttMoves(hole, { x: 2, y: 4 }, dist)) expect(m.dist).toBe(dist);
      for (const m of legalMoves(hole, { x: 2, y: 4 }, dist)) expect(m.dist).toBe(dist);
    }
    // Every putt `movesForRoll` offers is its plain length; only the hits climb.
    for (let roll = 1; roll <= 6; roll++) {
      for (const m of movesForRoll(hole, { x: 4, y: 6 }, roll)) {
        if (m.kind === 'putt') expect(m.climb).toBeUndefined();
      }
    }
  });

  it('offers no hit where a flat lie offers none, and keeps every direction a hit', () => {
    const hole = page({ ...ridge(0, 4, 9, -1), ...ridge(0, 3, 9, 1) });
    // Distance 1 (a roll of 1 from the rough) is a putt and nothing else, downhill or not.
    expect(movesForRoll(hole, { x: 4, y: 4 }, 1).every((m) => m.kind === 'putt')).toBe(true);
    expect(hitMoves(hole, { x: 4, y: 4 }, 0)).toEqual([]);
    // Every hit offered is one of the eight directions, once.
    const moves = hitMoves(hole, { x: 4, y: 4 }, 3);
    expect(new Set(moves.map((m) => m.dir)).size).toBe(moves.length);
    expect(moves.every((m) => dirs.includes(m.dir))).toBe(true);
  });
});

describe('what elevation says', () => {
  it('names the climb and what it did to the hit', () => {
    expect(liftWords(1, -1)).toBe('+1 uphill · 1 shorter');
    expect(liftWords(-1, 1)).toBe('−1 downhill · 1 longer');
    expect(liftWords(2, -2)).toBe('+2 uphill · 2 shorter');
    expect(liftWords(-2, 2)).toBe('−2 downhill · 2 longer');
    expect(liftWords(2, -1)).toBe('+2 uphill · 1 shorter');
    expect(liftWords(0, 0)).toBe('');
  });

  it('says it in one line when the whole aim climbs together', () => {
    expect(liftLine(-1, 1)).toBe('Downhill all round · 1 longer');
    expect(liftLine(1, -1)).toBe('Uphill all round · 1 shorter');
    expect(liftLine(-2, 2)).toBe('Downhill all round · 2 longer');
    expect(liftLine(0, 0)).toBe('');
  });

  it('has a compact tag for a phone, where there is no hover', () => {
    expect(liftTag(-1)).toBe('1 shorter');
    expect(liftTag(1)).toBe('1 longer');
    expect(liftTag(2)).toBe('2 longer');
    expect(liftTag(0)).toBe('');
  });

  it('says it once when every hit on offer climbs the same way', () => {
    // On a plateau with level ground all round: every direction is one space longer.
    const hole = page({ '4,4': { t: 'rough', e: 1 } });
    const from = { x: 4, y: 4 };
    const hits = hitMoves(hole, from, 3);
    expect(hits).toHaveLength(8);
    expect(sharedLift(from, hits)).toEqual({ climb: -1, shift: 1 });
    // All level: shared, and nothing to say.
    expect(sharedLift({ x: 4, y: 4 }, hitMoves(page(), { x: 4, y: 4 }, 3))).toEqual({ climb: 0, shift: 0 });
    // Mixed: no one line covers it, so each moved marker carries its own tag.
    const mixed = page({ ...ridge(0, 4, 5, 1), '4,1': { t: 'rough', e: -1 } });
    expect(sharedLift({ x: 4, y: 4 }, hitMoves(mixed, { x: 4, y: 4 }, 3))).toBeNull();
    expect(sharedLift(from, [])).toBeNull();
  });
});

describe('a round played over heights', () => {
  it('values a hole the solver can still finish, from every landable dot', () => {
    // A ridge right across the page: the hole still plays, because a hit carries over it.
    const hole = page({ ...ridge(0, 4, 9, 1) }, { x: 4, y: 0 });
    for (let roll = 1; roll <= 6; roll++) {
      const moves = movesForRoll(hole, hole.tee, roll);
      expect(moves.length).toBeGreaterThan(0);
    }
    // Each hit's recorded distance is the one `resolveShot` was asked for, so replaying it gives the same shot.
    for (const m of movesForRoll(hole, { x: 4, y: 5 }, 4)) {
      const again = resolveShot(hole, { x: 4, y: 5 }, m.dir, m.dist, CALM, false);
      expect(again).toEqual(m.result);
    }
  });

  it('keeps the heights a cell carries when nothing sets one', () => {
    const hole = page({ '4,4': { t: 'rough', e: 1 } });
    expect(at(hole.cells, 4 * hole.w + 4).e).toBe(1);
    expect(at(hole.cells, 4 * hole.w + 3).e).toBeUndefined();
  });
});
