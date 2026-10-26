import { describe, expect, it } from 'vitest';
import { holeFromAscii } from '../src/engine/ascii';
import {
  carryNote,
  elevationAllRound,
  elevationNote,
  heightAt,
  hitElevation,
  movesForRoll,
  onGreen,
  puttMoves,
  resolveShot,
} from '../src/engine/rules';
import { CALM, type Dir, type Hole, type P, type Wind } from '../src/engine/types';
import { at } from './helpers';

const N = 0;
const NE = 1;
const E = 2;
const W = 6;

/** A hit: elevation changes how far a hit carries. The same call without the flag is a putt or a bare straight shot. */
const hit = (h: Hole, from: P, dir: Dir, dist: number, wind: Wind = CALM, rain = false) =>
  resolveShot(h, from, dir, dist, wind, rain, true);

const ROW = '.........';
/** A 9x9 page of rough: the ball sits at (4,5) with room all round it, and the cup is out of the way in the corner. */
const page = (heights?: string[]) => holeFromAscii([`@${ROW.slice(1)}`, ROW, ROW, ROW, ROW, '....o....', ROW, ROW, ROW], heights);
const BALL: P = { x: 4, y: 5 };

/** Nine rows of the same string, with `row` replaced: the height map for one raised or lowered row. */
const rows = (row: number, text: string) => Array.from({ length: 9 }, (_, y) => (y === row ? text : ROW));
/** One raised cell at (x,y) on an otherwise level page. */
const raise = (x: number, y: number) => rows(y, `${ROW.slice(0, x)}+${ROW.slice(x + 1)}`);

describe('a cell has a height', () => {
  it('is level everywhere by default, on the page and off it', () => {
    const h = page();
    expect(h.cells.every((c) => c.z === undefined)).toBe(true);
    expect(heightAt(h, BALL)).toBe(0);
    expect(heightAt(h, { x: 4, y: 2 })).toBe(0);
    expect(heightAt(h, { x: -1, y: 99 })).toBe(0);
  });

  it('reads +1 and −1 off the map, and leaves every shot as it was when the page is level', () => {
    expect(heightAt(page(raise(4, 2)), { x: 4, y: 2 })).toBe(1);
    expect(heightAt(page(rows(2, '....-....')), { x: 4, y: 2 })).toBe(-1);
    const flat = page();
    for (let d = 0; d < 8; d++) {
      for (let dist = 2; dist <= 4; dist++) {
        expect(hit(flat, BALL, d as Dir, dist)).toEqual(resolveShot(flat, BALL, d as Dir, dist));
      }
    }
    expect(hitElevation(flat, BALL, N, 3)).toBeNull();
  });
});

describe('elevation changes how far a hit carries', () => {
  it('hits 1 shorter onto a plateau one level up', () => {
    const h = page(raise(4, 2));
    expect(hitElevation(h, BALL, N, 3)).toEqual({ climb: 1, shift: -1, level: { x: 4, y: 2 } });
    expect(hit(h, BALL, N, 3)).toMatchObject({
      legal: true,
      end: { x: 4, y: 3 },
      landing: { x: 4, y: 3 },
      elev: { climb: 1, shift: -1, level: { x: 4, y: 2 } },
    });
  });

  it('hits 1 further going one level down, off the plateau the ball stands on', () => {
    const h = page(raise(4, 5));
    expect(hitElevation(h, BALL, N, 3)).toEqual({ climb: -1, shift: 1, level: { x: 4, y: 2 } });
    expect(hit(h, BALL, N, 3)).toMatchObject({ legal: true, end: { x: 4, y: 1 }, elev: { climb: -1, shift: 1 } });
  });

  it('hits 2 further from a plateau into a dip, and 2 shorter the other way', () => {
    const down = page(rows(3, '....-....').map((r, y) => (y === 5 ? '....+....' : r)));
    expect(hit(down, BALL, N, 2)).toMatchObject({ end: { x: 4, y: 1 }, elev: { climb: -2, shift: 2 } });
    const up = page(rows(1, '....+....').map((r, y) => (y === 5 ? '....-....' : r)));
    expect(hit(up, BALL, N, 4)).toMatchObject({ end: { x: 4, y: 3 }, elev: { climb: 2, shift: -2 } });
  });

  it('never carries less than 1 dot, however steep the climb', () => {
    const h = page(rows(3, '....+....').map((r, y) => (y === 5 ? '....-....' : r)));
    // A 2-dot hit out of a dip onto a plateau: two levels up would leave no carry at all, so it carries 1.
    expect(hitElevation(h, BALL, N, 2)).toEqual({ climb: 2, shift: -1, level: { x: 4, y: 3 } });
    expect(hit(h, BALL, N, 2)).toMatchObject({ end: { x: 4, y: 4 }, elev: { climb: 2, shift: -1 } });
  });

  it('measures the normal landing and nothing else: no second pass', () => {
    // Shortened onto (4,3), which is a dip: its height is never read, so the ball just stops there.
    const h = page(rows(2, '....+....').map((r, y) => (y === 3 ? '....-....' : r)));
    expect(hit(h, BALL, N, 3)).toMatchObject({ end: { x: 4, y: 3 }, elev: { climb: 1, shift: -1 } });
    // And lengthened onto a plateau, which does not shorten it again.
    const g = page(rows(1, '....+....').map((r, y) => (y === 5 ? '....+....' : r)));
    expect(hit(g, BALL, N, 3)).toMatchObject({ end: { x: 4, y: 1 }, elev: { climb: -1, shift: 1 } });
  });

  it('works it out per direction, so the markers round one ball move by different amounts', () => {
    const h = page(rows(2, '....+..-.'));
    const moves = movesForRoll(h, BALL, 3).filter((m) => m.kind === 'hit');
    const shift = (dir: Dir) => at(moves.filter((m) => m.dir === dir), 0).result.elev?.shift;
    // N comes down on the plateau at (4,2) and NE in the dip at (7,2); east and west run along level ground.
    expect(shift(N)).toBe(-1);
    expect(shift(NE)).toBe(1);
    expect(shift(E)).toBeUndefined();
    expect(shift(W)).toBeUndefined();
    expect(moves.every((m) => m.dist === 3)).toBe(true);
  });
});

describe('what elevation never touches', () => {
  it('leaves every putt exactly as it was', () => {
    const h = page(raise(4, 5));
    // The ball stands a level above the dot north of it: a putt still moves one dot.
    expect(resolveShot(h, BALL, N, 1)).toMatchObject({ legal: true, end: { x: 4, y: 4 } });
    const putts = movesForRoll(h, BALL, 4).filter((m) => m.kind === 'putt');
    expect(putts.every((m) => m.dist === 1)).toBe(true);
    expect(at(putts.filter((m) => m.dir === N), 0).result.end).toEqual({ x: 4, y: 4 });
    expect(at(putts.filter((m) => m.dir === N), 0).result.elev).toBeUndefined();
  });

  it('leaves the green’s 2- and 3-dot putts alone, however the ground lies', () => {
    const map = ['.....', '..@..', '.....', '.....', '..o..'];
    const green = holeFromAscii(map, ['.....', '..+..', '.....', '..-..', '.....']);
    const from: P = { x: 2, y: 3 };
    expect(onGreen(green, from)).toBe(true);
    expect(puttMoves(green, from, 2).some((m) => m.dir === N && m.result.holed)).toBe(true);
    expect(movesForRoll(green, from, 2).every((m) => m.kind === 'putt')).toBe(true);
    expect(movesForRoll(green, from, 2).map((m) => m.dist)).toEqual(movesForRoll(holeFromAscii(map), from, 2).map((m) => m.dist));
  });

  it('keeps the base number on the move: the roll decides `dist`, elevation only moves the ball', () => {
    const h = page(raise(4, 5));
    const hits = movesForRoll(h, BALL, 3).filter((m) => m.kind === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((m) => m.dist === 3)).toBe(true);
    expect(at(hits.filter((m) => m.dir === N), 0).result.end).toEqual({ x: 4, y: 1 });
  });
});

describe('elevation comes before the wind and the slopes', () => {
  it('pushes the wind from where the hit really comes down', () => {
    const h = page(raise(4, 2));
    // The hit is shortened onto (4,3); the wind then pushes it one dot east, exactly as it would from any touchdown.
    expect(hit(h, BALL, N, 3, { strength: 1, dir: E })).toMatchObject({ landing: { x: 4, y: 3 }, end: { x: 5, y: 3 }, blown: true });
  });

  it('rolls the slope under the dot the hit really reaches, not the one it was aimed at', () => {
    const h = holeFromAscii([`@${ROW.slice(1)}`, ROW, '....>....', '....>....', ROW, '....o....', ROW, ROW, ROW], raise(4, 2));
    // Aimed at (4,2), shortened onto (4,3), which has a slope east: the ball rolls on from there.
    expect(hit(h, BALL, N, 3)).toMatchObject({ landing: { x: 4, y: 3 }, end: { x: 5, y: 3 }, rolled: true });
  });

  it('is worked out after the rain has taken its space off the hit', () => {
    const h = page(raise(4, 5));
    const hits = (rain: boolean) => movesForRoll(h, BALL, 4, CALM, rain).filter((m) => m.kind === 'hit');
    // Roll 4 from the rough: 4 dots dry and 3 in the rain, then one further going downhill either way.
    expect(at(hits(false).filter((m) => m.dir === N), 0).result.end).toEqual({ x: 4, y: 0 });
    expect(at(hits(true).filter((m) => m.dir === N), 0).result.end).toEqual({ x: 4, y: 1 });
    expect(hits(true).every((m) => m.dist === 3)).toBe(true);
  });
});

describe('holing out on the adjusted path', () => {
  /** A 3-wide column: the ball at (1,6), and the cup `up` dots north of it. */
  const col = (up: number, heights: string[]) =>
    holeFromAscii(
      Array.from({ length: 7 }, (_, y) => (y === 6 ? '.o.' : y === 6 - up ? '.@.' : '...')),
      heights,
    );
  const colHeights = (row: number) => Array.from({ length: 7 }, (_, y) => (y === row ? '.+.' : '...'));
  const from: P = { x: 1, y: 6 };

  it('drops when the shortened hit lands in the cup', () => {
    expect(hit(col(2, colHeights(3)), from, N, 3)).toMatchObject({ legal: true, holed: true });
  });

  it('comes up short of a cup a level hit would have holed', () => {
    expect(hit(col(3, colHeights(3)), from, N, 3)).toMatchObject({ legal: true, holed: false, end: { x: 1, y: 4 } });
  });

  it('still allows the overshoot by one, measured along the longer carry', () => {
    expect(hit(col(3, colHeights(6)), from, N, 3)).toMatchObject({ legal: true, holed: true });
  });
});

describe('what the screen says about it', () => {
  it('names the climb and what it did to the carry', () => {
    expect(elevationNote({ climb: 1, shift: -1, level: BALL })).toBe('+1 uphill · 1 shorter');
    expect(elevationNote({ climb: -1, shift: 1, level: BALL })).toBe('−1 downhill · 1 longer');
    expect(elevationNote({ climb: -2, shift: 2, level: BALL })).toBe('−2 downhill · 2 longer');
    expect(elevationNote({ climb: 2, shift: -2, level: BALL })).toBe('+2 uphill · 2 shorter');
    // Clamped at a carry of 1: the climb is two levels, the carry only lost one dot.
    expect(elevationNote({ climb: 2, shift: -1, level: BALL })).toBe('+2 uphill · 1 shorter');
  });

  it('has a compact form for a marker, and one line for when every direction moves the same way', () => {
    expect(carryNote(-1)).toBe('1 shorter');
    expect(carryNote(2)).toBe('2 longer');
    expect(elevationAllRound({ climb: -1, shift: 1, level: BALL })).toBe('Downhill all round · 1 longer');
    expect(elevationAllRound({ climb: 1, shift: -1, level: BALL })).toBe('Uphill all round · 1 shorter');
  });
});
