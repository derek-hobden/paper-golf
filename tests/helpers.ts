/**
 * Shared test helpers. Under `noUncheckedIndexedAccess` every index read is `T | undefined`; tests use these
 * narrowing helpers (which throw with a clear message) instead of `!` or casts.
 */
import {
  GREEN_RADIUS,
  cellAt,
  diceDistance,
  dotsApart,
  isLandable,
  legalMoves,
  movesForRoll,
  onGreen,
  puttMoves,
  samePos,
  step,
} from '../src/engine/rules';
import { DIRS, type Cell, type Dir, type Hole, type P, type Wind } from '../src/engine/types';
import {
  autoPutt,
  autoPuttMove,
  availableMoves,
  currentBall,
  currentHole,
  holeRain,
  holeWind,
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

/** The same page laid flat: `hole` with every height taken off its cells. */
export function levelled(hole: Hole): Hole {
  return {
    ...hole,
    cells: hole.cells.map((c) => {
      const cell: Cell = { ...c };
      delete cell.z;
      return cell;
    }),
  };
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
 * On the green, so never a bunker two dots out: sand plays as sand and offers a hit instead (`tests/sand.test.ts`).
 */
export function offLineTwoDotSpot(g: GameState): P {
  const hole = currentHole(g);
  for (const [dx, dy] of [[2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]] as const) {
    const p: P = { x: hole.cup.x + dx, y: hole.cup.y + dy };
    if (isLandable(hole, p) && onGreen(hole, p) && puttMoves(hole, p, 2).length > 0) return p;
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

/**
 * Every sand dot a ball can rest on inside the green's ring on `hole`, two dots or more from the cup (a dot next to
 * it is a tap-in, so no lie is read there): the greenside bunkers, which used to play as green.
 */
export function greensideBunkers(hole: Hole): P[] {
  const out: P[] = [];
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const p = { x, y };
      const d = dotsApart(p, hole.cup);
      if (isLandable(hole, p) && cellAt(hole, p).t === 'sand' && d > 1 && d <= GREEN_RADIUS) out.push(p);
    }
  return out;
}

/** The first greenside bunker on the current hole; throws when the hole has none. */
export function greensideBunker(g: GameState): P {
  return defined(greensideBunkers(currentHole(g))[0], 'a greenside bunker on this hole');
}

/**
 * A shot on the current hole that comes to rest in a greenside bunker: the spot to play it from (far enough from the
 * cup that no tap-in is due), the die, and the bunker it ends in. The roll holes nothing, so the shot is tapped.
 */
export function shotIntoBunker(g: GameState): { from: P; die: number; bunker: P } {
  const hole = currentHole(g);
  const bunkers = greensideBunkers(hole);
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const from = { x, y };
      if (!isLandable(hole, from) || dotsApart(from, hole.cup) <= 1) continue;
      for (let die = 1; die <= 6; die++) {
        const moves = movesForRoll(hole, from, die, holeWind(g), holeRain(g));
        if (moves.some((m) => m.result.holed)) continue;
        const into = moves.find((m) => m.kind === 'hit' && bunkers.some((b) => samePos(b, m.result.end)));
        if (into) return { from, die, bunker: into.result.end };
      }
    }
  throw new Error('no shot into a greenside bunker');
}

/**
 * A die that offers a sand shot out of `from` and holes nothing, so its targets are tapped rather than played by the
 * auto hole-out.
 */
export function sandShotDie(g: GameState, from: P): number {
  const hole = currentHole(g);
  for (let die = 2; die <= 6; die++) {
    const moves = movesForRoll(hole, from, die, holeWind(g), holeRain(g));
    if (!moves.some((m) => m.result.holed) && moves.some((m) => m.kind === 'hit')) return die;
  }
  throw new Error('no sand shot that holes nothing');
}

/** A w×h test hole of rough with terrain overrides keyed "x,y" (slopes included); the cup at `cup`. */
export function testHole(w: number, h: number, cup: P, overrides: Record<string, Cell> = {}): Hole {
  const cells: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(overrides[`${String(x)},${String(y)}`] ?? { t: 'rough' });
  return { course: 0, number: 1, seed: 1, w, h, cells, tee: { x: 0, y: h - 1 }, cup, par: 4 };
}
