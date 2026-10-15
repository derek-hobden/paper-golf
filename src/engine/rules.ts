import { gridAt } from './grid';
import { CALM, DIRS, type Cell, type Dir, type Hole, type P, type Wind } from './types';

/** A player who has not holed out after this many strokes picks up. */
export const MAX_STROKES = 10;
export const MULLIGANS_PER_ROUND = 6;

export function inBounds(hole: Hole, p: P): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < hole.w && p.y < hole.h;
}

export function cellAt(hole: Hole, p: P): Cell {
  return gridAt(hole.cells, hole.w, p.x, p.y);
}

export function samePos(a: P, b: P): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Cells a ball may come to rest on. */
export function isLandable(hole: Hole, p: P): boolean {
  if (!inBounds(hole, p)) return false;
  const t = cellAt(hole, p).t;
  return t !== 'water' && t !== 'tree';
}

export function step(p: P, dir: Dir, k = 1): P {
  return { x: p.x + DIRS[dir].x * k, y: p.y + DIRS[dir].y * k };
}

export interface ShotResult {
  legal: boolean;
  /** Why the shot is illegal, for UI hints. */
  reason?: 'offgrid' | 'trees' | 'water';
  holed: boolean;
  /** Where the ball first touches down (before any slope roll). */
  landing: P;
  /** Final resting place (equals cup when holed). */
  end: P;
  /** True when a slope rolled the ball (before or after any wind push). */
  rolled: boolean;
  /** The dots slopes rolled the ball onto before any wind push, in order (for the dashed roll line). */
  rolls?: P[];
  /** Present when the wind pushed the resting ball: it ends on `end`, not where it touched down (or rolled to). */
  blown?: true;
}

const dotKey = (p: P) => `${String(p.x)},${String(p.y)}`;

/**
 * A ball resting on a slope always rolls one dot that way, then again from wherever it stops, so slopes chain. It
 * stays put when the next dot is off the page, water or trees; it drops when the next dot is the cup. A chain that
 * would roll back onto a dot it already rested on during this shot (`seen`: two slopes facing each other, a ring of
 * slopes) is a loop: the ball stops where the loop is found. Returns the dots rolled onto, in order.
 */
export function rollSlopes(hole: Hole, rest: P, seen: Set<string> = new Set()): { path: P[]; holed: boolean } {
  const path: P[] = [];
  seen.add(dotKey(rest));
  let at = rest;
  for (let slope = cellAt(hole, at).slope; slope !== undefined; slope = cellAt(hole, at).slope) {
    const next = step(at, slope);
    if (samePos(next, hole.cup)) return { path: [...path, next], holed: true };
    if (!isLandable(hole, next) || seen.has(dotKey(next))) break;
    path.push(next);
    seen.add(dotKey(next));
    at = next;
  }
  return { path, holed: false };
}

/**
 * Push a ball resting on `rest` up to `wind.strength` squares downwind (a diagonal step moves 1 on each axis). The
 * push stops early at the edge of the board or before any square the ball could not finish on (water, trees). The
 * ball holes only when the square it ends on is the cup; blown over the cup, it does not drop.
 */
export function applyWind(hole: Hole, rest: P, wind: Wind): { end: P; holed: boolean; moved: boolean } {
  let end = rest;
  for (let k = 0; k < wind.strength; k++) {
    const next = step(end, wind.dir);
    if (!isLandable(hole, next)) break;
    end = next;
  }
  return { end, holed: samePos(end, hole.cup), moved: !samePos(end, rest) };
}

/**
 * Resolve a straight shot of exactly `dist` spaces in direction `dir`, then let `wind` push where it comes to rest
 * (`applyWind`; a ball that already dropped stays in the cup), then let slopes roll it on from there. Putts are
 * played with `CALM` (slopes still roll them).
 *
 * - Passing over the cup earlier than one space short of the landing spot is a fly-over.
 * - Reaching the cup at step dist or dist-1 holes the ball (you may overshoot by 1).
 * - Water may be flown over but not landed in.
 * - Trees may be flown over only when hitting from the fairway; never landed in.
 * - Coming to rest on a slope arrow (after landing, a slope or the wind) rolls the ball one more space that way, and
 *   on down any chain of slopes (`rollSlopes`).
 */
export function resolveShot(hole: Hole, from: P, dir: Dir, dist: number, wind: Wind = CALM): ShotResult {
  const seen = new Set<string>();
  const calm = resolveCalmShot(hole, from, dir, dist, seen);
  if (!calm.legal || calm.holed || wind.strength === 0) return calm;
  const pushed = applyWind(hole, calm.end, wind);
  if (!pushed.moved) return calm;
  const blown: ShotResult = { ...calm, holed: pushed.holed, end: pushed.end, blown: true };
  if (pushed.holed) return blown;
  const after = rollSlopes(hole, pushed.end, seen);
  const last = after.path.at(-1);
  return last ? { ...blown, holed: after.holed, end: last, rolled: true } : blown;
}

function resolveCalmShot(hole: Hole, from: P, dir: Dir, dist: number, seen: Set<string>): ShotResult {
  const fromFairway = cellAt(hole, from).t === 'fairway';
  const fail = (reason: ShotResult['reason'], at: P): ShotResult => ({
    legal: false,
    reason,
    holed: false,
    landing: at,
    end: at,
    rolled: false,
  });
  if (dist < 1) return fail('offgrid', from);
  for (let k = 1; k <= dist; k++) {
    const p = step(from, dir, k);
    if (samePos(p, hole.cup) && k >= dist - 1) {
      return { legal: true, holed: true, landing: p, end: p, rolled: false };
    }
    if (!inBounds(hole, p)) return fail('offgrid', p);
    const t = cellAt(hole, p).t;
    if (k < dist) {
      if (t === 'tree' && !fromFairway) return fail('trees', p);
      continue;
    }
    if (t === 'tree') return fail('trees', p);
    if (t === 'water') return fail('water', p);
    const { path, holed } = rollSlopes(hole, p, seen);
    const last = path.at(-1);
    if (!last) return { legal: true, holed: false, landing: p, end: p, rolled: false };
    return { legal: true, holed, landing: p, end: last, rolled: true, rolls: path };
  }
  return fail('offgrid', from);
}

/** Dice hit distance: roll +1 from the fairway, -1 from sand. May be 0 (then only a putt is possible). */
export function diceDistance(hole: Hole, from: P, roll: number): number {
  const t = cellAt(hole, from).t;
  const mod = t === 'fairway' ? 1 : t === 'sand' ? -1 : 0;
  return Math.max(0, roll + mod);
}

export interface Move {
  dir: Dir;
  dist: number;
  result: ShotResult;
}

export function legalMoves(hole: Hole, from: P, dist: number, wind: Wind = CALM): Move[] {
  const out: Move[] = [];
  if (dist < 1) return out;
  for (let d = 0; d < 8; d++) {
    const result = resolveShot(hole, from, d as Dir, dist, wind);
    if (result.legal) out.push({ dir: d as Dir, dist, result });
  }
  return out;
}

/** Steps between two cells when moving in the 8 directions (Chebyshev distance). */
export function dotsApart(a: P, b: P): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** The green: every cell within this many dots of the cup (diagonals count, like every move). */
export const GREEN_RADIUS = 2;

export function onGreen(hole: Hole, p: P): boolean {
  return inBounds(hole, p) && dotsApart(p, hole.cup) <= GREEN_RADIUS;
}

/** A ball resting this close to the cup is putted in automatically (a 1-dot putt always holes from there). */
export const isTapIn = (hole: Hole, p: P) => dotsApart(p, hole.cup) === 1;

/**
 * On the green you may only putt. Besides the 1-dot putt (always allowed), the die can earn a longer putt: a roll of
 * exactly 2 allows a 2-dot putt, a roll of exactly 3 a 3-dot putt; any other roll leaves only the 1-dot putt. Lie
 * modifiers (+1 fairway, -1 sand) do not apply to putts.
 */
export function greenPuttLength(roll: number): number {
  return roll === 2 || roll === 3 ? roll : 1;
}

/**
 * Putts of `dist` dots: straight shots that stay on the ground, so every dot rolled over before the ball stops (or
 * drops) must be one it could rest on (no rolling through water or trees). Same holing rules as any shot.
 */
export function puttMoves(hole: Hole, from: P, dist: number): Move[] {
  return legalMoves(hole, from, dist).filter((m) => {
    for (let k = 1; k < dist; k++) {
      const p = step(from, m.dir, k);
      if (samePos(p, hole.cup)) return true;
      if (!isLandable(hole, p)) return false;
    }
    return true;
  });
}

export interface RollMove extends Move {
  kind: 'hit' | 'putt';
}

/**
 * Every legal shot from `from` after rolling `roll`: the 1-dot putt, plus either the green putt the roll earns
 * (on the green) or a hit of the dice distance (off it). Shared by the game and the solver. The `wind` moves hits
 * only: putts (on the green or the 1-dot putt from anywhere) are never blown.
 */
export function movesForRoll(hole: Hole, from: P, roll: number, wind: Wind = CALM): RollMove[] {
  const out: RollMove[] = legalMoves(hole, from, 1).map((m) => ({ ...m, kind: 'putt' as const }));
  if (onGreen(hole, from)) {
    const len = greenPuttLength(roll);
    if (len > 1) out.push(...puttMoves(hole, from, len).map((m) => ({ ...m, kind: 'putt' as const })));
    return out;
  }
  const dist = diceDistance(hole, from, roll);
  if (dist > 1) out.push(...legalMoves(hole, from, dist, wind).map((m) => ({ ...m, kind: 'hit' as const })));
  return out;
}
