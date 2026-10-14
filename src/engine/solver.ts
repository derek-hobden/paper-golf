import { itemAt } from './assert';
import { isLandable, legalMoves, movesForRoll, samePos } from './rules';
import type { Hole, P } from './types';

const key = (hole: Hole, p: P) => p.y * hole.w + p.x;

/**
 * Expected strokes to hole out in Dice Golf under optimal play (value iteration),
 * ignoring tee re-rolls and mulligans (which only help). Returns per-cell values; Infinity = unsolvable.
 */
export function diceExpectation(hole: Hole): Float64Array {
  const n = hole.w * hole.h;
  const BIG = 1e9;
  const v = new Float64Array(n).fill(BIG);
  const cells: P[] = [];
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) if (isLandable(hole, { x, y })) cells.push({ x, y });
  v[key(hole, hole.cup)] = 0;
  // Precompute option sets: for each cell and roll, the possible outcomes (holed => -1). A tap-in (next to the cup)
  // always holes in one whatever the roll, and the 1-dot putt in every roll's options already gives it that value.
  const options = cells.map((p) => {
    const byRoll: number[][] = [];
    for (let r = 1; r <= 6; r++) {
      byRoll.push(movesForRoll(hole, p, r).map((m) => (m.result.holed ? -1 : key(hole, m.result.end))));
    }
    return byRoll;
  });
  for (let iter = 0; iter < 400; iter++) {
    let delta = 0;
    cells.forEach((p, i) => {
      const k = key(hole, p);
      if (samePos(p, hole.cup)) return;
      let sum = 0;
      for (const outs of itemAt(options, i, 'option set')) {
        let best = BIG;
        for (const o of outs) best = Math.min(best, o < 0 ? 0 : itemAt(v, o, 'cell value'));
        sum += best;
      }
      const nv = Math.min(BIG, 1 + sum / 6);
      delta = Math.max(delta, Math.abs(nv - itemAt(v, k, 'cell value')));
      v[k] = nv;
    });
    if (iter > 30 && delta < 1e-6) break;
  }
  for (let i = 0; i < n; i++) if (itemAt(v, i, 'cell value') >= BIG / 2) v[i] = Infinity;
  return v;
}

export function diceExpectedFromTee(hole: Hole): number {
  return itemAt(diceExpectation(hole), key(hole, hole.tee), 'tee cell');
}

/** Cells reachable from `start` by putting alone (a putt is always allowed). */
export function puttComponent(hole: Hole, start: P): Set<number> {
  const seen = new Set<number>([key(hole, start)]);
  const stack = [start];
  for (let p = stack.pop(); p; p = stack.pop()) {
    for (const m of legalMoves(hole, p, 1)) {
      const q = m.result.end;
      const k = key(hole, q);
      if (!seen.has(k)) {
        seen.add(k);
        if (!m.result.holed) stack.push(q);
      }
    }
  }
  return seen;
}
