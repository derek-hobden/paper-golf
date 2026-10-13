/**
 * Shared test helpers. Under `noUncheckedIndexedAccess` every index read is `T | undefined`; tests use these
 * narrowing helpers (which throw with a clear message) instead of `!` or casts.
 */
import { diceDistance, isLandable, legalMoves } from '../src/engine/rules';
import { DIRS, type Dir, type P } from '../src/engine/types';
import { availableMoves, currentBall, currentHole, roll, shoot, type GameState, type MoveOption } from '../src/game/game';

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

const dirs: readonly Dir[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** A landable spot next to the cup from which a putt in `dir` holes out. */
function spotNextToCup(g: GameState): { pos: P; dir: Dir } {
  const hole = currentHole(g);
  for (const dir of dirs) {
    const d = at(DIRS, dir);
    const pos = { x: hole.cup.x - d.x, y: hole.cup.y - d.y };
    if (isLandable(hole, pos) && legalMoves(hole, pos, 1).some((m) => m.dir === dir && m.result.holed)) return { pos, dir };
  }
  throw new Error('no spot next to the cup');
}

/** Put the current player's ball next to the cup and hole it with a putt (one stroke). */
export function holeOutWithPutt(g: GameState): void {
  const { pos, dir } = spotNextToCup(g);
  currentBall(g).pos = { ...pos };
  roll(g, 1);
  shoot(g, dir, 1);
}

/** The current player putts somewhere without holing out (one stroke). */
export function puttWithoutHoling(g: GameState): void {
  roll(g, 1);
  const m = findMove(availableMoves(g), (o) => o.kind === 'putt' && !o.result.holed, 'non-holing putt');
  shoot(g, m.dir, m.dist);
}

/**
 * A landable spot one space short of the cup, plus the die value that makes the hit distance from there
 * exactly 2, so the hit overshoots the cup by one.
 */
export function overshootSetup(g: GameState): { pos: P; dir: Dir; die: number } {
  const hole = currentHole(g);
  for (const dir of dirs) {
    const d = at(DIRS, dir);
    const pos = { x: hole.cup.x - d.x, y: hole.cup.y - d.y };
    if (!isLandable(hole, pos)) continue;
    for (let die = 1; die <= 6; die++) if (diceDistance(hole, pos, die) === 2) return { pos, dir, die };
  }
  throw new Error('no overshoot spot');
}
