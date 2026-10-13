import { gridAt } from './grid';
import { DIRS, type Cell, type Dir, type Hole, type P } from './types';

export const PAR = 6;
/** A player who has not holed out after this many strokes picks up. */
export const MAX_STROKES = 10;
export const MULLIGANS_PER_COURSE = 6;

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
  /** True when a slope rolled the ball one space. */
  rolled: boolean;
}

/**
 * Resolve a straight shot of exactly `dist` spaces in direction `dir`.
 *
 * - Passing over the cup earlier than one space short of the landing spot is a fly-over.
 * - Reaching the cup at step dist or dist-1 holes the ball (you may overshoot by 1).
 * - Water may be flown over but not landed in.
 * - Trees may be flown over only when hitting from the fairway; never landed in.
 * - Landing on a slope arrow rolls the ball one more space that way (if it can rest there).
 */
export function resolveShot(hole: Hole, from: P, dir: Dir, dist: number): ShotResult {
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
    const slope = cellAt(hole, p).slope;
    if (slope !== undefined) {
      const q = step(p, slope);
      if (samePos(q, hole.cup)) return { legal: true, holed: true, landing: p, end: q, rolled: true };
      if (isLandable(hole, q)) return { legal: true, holed: false, landing: p, end: q, rolled: true };
    }
    return { legal: true, holed: false, landing: p, end: p, rolled: false };
  }
  return fail('offgrid', from);
}

/** Dice Golf hit distance: roll +1 from the fairway, -1 from sand. May be 0 (then only a putt is possible). */
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

export function legalMoves(hole: Hole, from: P, dist: number): Move[] {
  const out: Move[] = [];
  if (dist < 1) return out;
  for (let d = 0; d < 8; d++) {
    const result = resolveShot(hole, from, d as Dir, dist);
    if (result.legal) out.push({ dir: d as Dir, dist, result });
  }
  return out;
}
