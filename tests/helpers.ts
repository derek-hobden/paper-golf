/**
 * Shared test helpers. Under `noUncheckedIndexedAccess` every index read is `T | undefined`; tests use these
 * narrowing helpers (which throw with a clear message) instead of `!` or casts.
 */
import { diceDistance, dotsApart, isLandable, legalMoves, movesForRoll, onGreen, puttMoves, step } from '../src/engine/rules';
import { DIRS, type Cell, type Dir, type Hole, type P, type Wind } from '../src/engine/types';
import {
  autoPutt,
  autoPuttMove,
  availableMoves,
  currentBall,
  currentHole,
  roll,
  shoot,
  type GameState,
  type MoveOption,
} from '../src/game/game';

/** Element `i` of an array (or typed array); throws if it is missing. */
export function at<T>(xs: ArrayLike<T>, i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at index ${String(i)} (length ${String(xs.length)})`);
  return v;
}

/** Narrow away null/undefined; throws if the value is missing. */
export function defined<T>(x: T | null | undefined, what = 'value'): T {
  if (x === undefined || x === null) throw new Error(`expected ${what} to be defined`);
  return x;
}

/** The first move matching `pred`; throws if there is none. */
export function findMove(moves: MoveOption[], pred: (m: MoveOption) => boolean, what = 'matching move'): MoveOption {
  return defined(moves.find(pred), what);
}

export const dirs: readonly Dir[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** A landable spot next to the cup from which a putt in `dir` holes out; `diagonal` restricts the direction. */
export function spotNextToCup(g: GameState, diagonal?: boolean): { pos: P; dir: Dir } {
  const hole = currentHole(g);
  for (const dir of dirs) {
    if (diagonal !== undefined && diagonal !== (dir % 2 === 1)) continue;
    const d = at(DIRS, dir);
    const pos = { x: hole.cup.x - d.x, y: hole.cup.y - d.y };
    if (isLandable(hole, pos) && legalMoves(hole, pos, 1).some((m) => m.dir === dir && m.result.holed)) return { pos, dir };
  }
  throw new Error('no spot next to the cup');
}

/** Put the current player's ball next to the cup; the tap-in then holes it (one stroke, no roll). */
export function holeOutWithPutt(g: GameState): void {
  currentBall(g).pos = { ...spotNextToCup(g).pos };
  autoPutt(g);
}

/** The current player putts somewhere without holing out, and off the green where possible (no tap-in next turn). */
export function puttWithoutHoling(g: GameState): void {
  roll(g, 1);
  const hole = currentHole(g);
  const putts = availableMoves(g).filter((o) => o.kind === 'putt' && !o.result.holed);
  const m = putts.find((o) => !onGreen(hole, o.result.end)) ?? findMove(putts, () => true, 'non-holing putt');
  shoot(g, m.dir, m.dist);
}

/** Play whatever is due: the tap-in if one is, else roll `die` and play `pick` of the available moves. */
export function playTurn(g: GameState, die: number, pick: (moves: MoveOption[]) => MoveOption): void {
  if (autoPuttMove(g)) {
    autoPutt(g);
    return;
  }
  roll(g, die);
  const m = pick(availableMoves(g));
  shoot(g, m.dir, m.dist);
}

/**
 * A landable spot off the green, plus a die value and direction whose hit lands exactly one dot past the cup, so
 * the hit holes by overshooting it by one.
 */
export function overshootSetup(g: GameState): { pos: P; dir: Dir; die: number } {
  const hole = currentHole(g);
  for (let back = 3; back <= 6; back++)
    for (const dir of dirs) {
      const pos = step(hole.cup, ((dir + 4) % 8) as Dir, back);
      if (!isLandable(hole, pos) || onGreen(hole, pos) || dotsApart(pos, hole.cup) !== back) continue;
      if (!legalMoves(hole, pos, back + 1).some((m) => m.dir === dir && m.result.holed)) continue;
      for (let die = 1; die <= 6; die++) if (diceDistance(hole, pos, die) === back + 1) return { pos, dir, die };
    }
  throw new Error('no overshoot spot');
}

/**
 * A landable spot on the green 2 dots from the cup but off every line to it (a knight's move away), with a 2-dot
 * putt to play: no putt can hole from there, so a rolled 2 offers its putt markers instead of holing by itself.
 */
export function offLineTwoDotSpot(g: GameState): P {
  const hole = currentHole(g);
  for (const [dx, dy] of [[2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]] as const) {
    const p: P = { x: hole.cup.x + dx, y: hole.cup.y + dy };
    if (isLandable(hole, p) && puttMoves(hole, p, 2).length > 0) return p;
  }
  throw new Error('no off-line 2-dot spot');
}

/** A spot, wind and die on the current hole where only the wind makes a hit drop (calm, no shot holes). */
export function windOnlyHoleOut(g: GameState): { pos: P; wind: Wind; die: number } {
  const hole = currentHole(g);
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const pos = { x, y };
      if (!isLandable(hole, pos) || onGreen(hole, pos)) continue;
      for (const strength of [1, 2] as const)
        for (const dir of dirs)
          for (let die = 1; die <= 6; die++) {
            const w: Wind = { strength, dir };
            if (movesForRoll(hole, pos, die).some((m) => m.result.holed)) continue;
            if (movesForRoll(hole, pos, die, w).some((m) => m.result.holed && m.kind === 'hit')) return { pos, wind: w, die };
          }
    }
  throw new Error('no wind-only hole-out');
}

/** A w×h test hole of rough with terrain overrides keyed "x,y" (slopes included); the cup at `cup`. */
export function testHole(w: number, h: number, cup: P, overrides: Record<string, Cell> = {}): Hole {
  const cells: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(overrides[`${String(x)},${String(y)}`] ?? { t: 'rough' });
  return { course: 0, number: 1, seed: 1, w, h, cells, tee: { x: 0, y: h - 1 }, cup, par: 4 };
}
