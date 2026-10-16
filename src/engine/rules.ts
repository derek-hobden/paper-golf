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
  /** Where the ball first touches down, the un-winded aim (before wind and slopes; off the page when the wind brings
   * it back). */
  landing: P;
  /** Final resting place (equals cup when holed). */
  end: P;
  /** True when a slope rolled the ball (from where it rested after any wind push). */
  rolled: boolean;
  /** The dots slopes rolled the ball onto, in order (for the dashed roll line). */
  rolls?: P[];
  /** Present when the wind moved the ball off its touchdown (then slopes may roll it on to `end`). */
  blown?: true;
}

const dotKey = (p: P) => `${String(p.x)},${String(p.y)}`;

/**
 * A ball resting on a slope always rolls one dot that way, then again from wherever it stops, so slopes chain. It
 * stays put when the next dot is off the page, water or trees; it drops when the next dot is the cup. A chain that
 * would roll back onto a dot it already rested on in this chain (`seen`: two slopes facing each other, a ring of
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
 * Push a ball resting on (or coming down at) `rest` by the wind's full vector: `wind.strength` dots downwind, a
 * diagonal step moving 1 on each axis. The ball is in the air while the wind carries it, so only the dot it ends on
 * counts: dots it passes over (off the page, water, trees) never stop it, and there is no clamping at the edge. If that
 * dot is one the ball cannot rest on (off the page, water or trees), the push returns null (the shot is not offered).
 * The ball holes only when the dot it ends on is the cup; blown over the cup, it does not drop.
 */
export function applyWind(hole: Hole, rest: P, wind: Wind): { end: P; holed: boolean; moved: boolean } | null {
  const end = step(rest, wind.dir, wind.strength);
  if (!isLandable(hole, end)) return null;
  return { end, holed: samePos(end, hole.cup), moved: !samePos(end, rest) };
}

/**
 * Resolve a straight shot of exactly `dist` spaces in direction `dir`. The one resolver behind shot targets, previews,
 * the curved lines, the auto shot, the solver and the sims. In order:
 *
 * 1. The flight. Passing over the cup earlier than one space short of touchdown is a fly-over; reaching it at step
 *    dist or dist-1 holes the ball (you may overshoot by 1), and the wind never touches a ball in the cup. Water may be
 *    flown over; trees only when hitting from the fairway.
 * 2. Touchdown on `landing`, the un-winded aim. On the page it must be a dot the ball can rest on (not water or trees).
 * 3. The wind (`applyWind`) pushes the ball its full vector, over anything in between. The dot it ends on must be one
 *    the ball can rest on (on the page, not water or trees), or the shot is illegal: a touchdown on the page can be
 *    blown off it or into water or trees, and one off the page counts only when the wind brings it back on to such a
 *    dot. Putts are played with `CALM`.
 * 4. Only then do slopes act, from the dot where the ball actually rests, chaining (`rollSlopes`). A slope at the
 *    touchdown matters only when the wind leaves the ball there. The ball holes when it ends on the cup.
 */
export function resolveShot(hole: Hole, from: P, dir: Dir, dist: number, wind: Wind = CALM): ShotResult {
  const fromFairway = cellAt(hole, from).t === 'fairway';
  const blows = wind.strength > 0;
  const fail = (reason: ShotResult['reason'], at: P): ShotResult => ({
    legal: false,
    reason,
    holed: false,
    landing: at,
    end: at,
    rolled: false,
  });
  if (dist < 1) return fail('offgrid', from);
  for (let k = 1; k < dist; k++) {
    const p = step(from, dir, k);
    if (samePos(p, hole.cup) && k >= dist - 1) return { legal: true, holed: true, landing: p, end: p, rolled: false };
    // Off the page in flight: the touchdown is off it too (a straight line), which only the wind can bring back.
    if (!inBounds(hole, p)) {
      if (blows) continue;
      return fail('offgrid', p);
    }
    if (cellAt(hole, p).t === 'tree' && !fromFairway) return fail('trees', p);
  }
  const landing = step(from, dir, dist);
  if (samePos(landing, hole.cup)) return { legal: true, holed: true, landing, end: landing, rolled: false };
  if (inBounds(hole, landing)) {
    const t = cellAt(hole, landing).t;
    if (t === 'tree') return fail('trees', landing);
    if (t === 'water') return fail('water', landing);
  } else if (!blows) return fail('offgrid', landing);
  const pushed = applyWind(hole, landing, wind);
  if (!pushed) {
    const blownTo = step(landing, wind.dir, wind.strength);
    const t = inBounds(hole, blownTo) ? cellAt(hole, blownTo).t : undefined;
    return fail(t === 'tree' ? 'trees' : t === 'water' ? 'water' : 'offgrid', landing);
  }
  const rest = pushed.end;
  const result: ShotResult = { legal: true, holed: false, landing, end: rest, rolled: false };
  if (!samePos(rest, landing)) result.blown = true;
  if (samePos(rest, hole.cup)) return { ...result, holed: true };
  const { path, holed } = rollSlopes(hole, rest);
  const last = path.at(-1);
  return last ? { ...result, holed, end: last, rolled: true, rolls: path } : result;
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
