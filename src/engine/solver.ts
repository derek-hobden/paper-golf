import { itemAt } from './assert';
import { isLandable, legalMoves, movesForRoll, samePos } from './rules';
import { CALM, type Hole, type P, type Wind } from './types';

const key = (hole: Hole, p: P) => p.y * hole.w + p.x;

/** Holing out, in an option set: the outcome that ends the hole rather than landing on a cell. */
const HOLED = -1;

/** Every landable cell of the hole, in row order. */
function landableCells(hole: Hole): P[] {
  const cells: P[] = [];
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) if (isLandable(hole, { x, y })) cells.push({ x, y });
  return cells;
}

/**
 * For each cell of `cells` and each roll 1..6, where the legal shots end (`HOLED` when they hole out). A tap-in (next
 * to the cup) always holes in one whatever the roll, and the 1-dot putt in every roll's options already gives it that.
 */
function optionSets(hole: Hole, cells: readonly P[], wind: Wind, rain: boolean): number[][][] {
  return cells.map((p) => {
    const byRoll: number[][] = [];
    for (let r = 1; r <= 6; r++) {
      byRoll.push(movesForRoll(hole, p, r, wind, rain).map((m) => (m.result.holed ? HOLED : key(hole, m.result.end))));
    }
    return byRoll;
  });
}

/**
 * Expected strokes to hole out with the die under optimal play (value iteration),
 * ignoring tee re-rolls and mulligans (which only help). Returns per-cell values; Infinity = unsolvable.
 * `rain` values the hole as it plays in the rain: hits one space shorter and no slope rolling the ball on.
 * `wind` values it in that wind (hits pushed, putts never); the par windows and the builder's reachability
 * leave it calm.
 */
export function diceExpectation(hole: Hole, rain = false, wind: Wind = CALM): Float64Array {
  const n = hole.w * hole.h;
  const BIG = 1e9;
  const v = new Float64Array(n).fill(BIG);
  const cells = landableCells(hole);
  v[key(hole, hole.cup)] = 0;
  const options = optionSets(hole, cells, wind, rain);
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

export function diceExpectedFromTee(hole: Hole, rain = false, wind: Wind = CALM): number {
  return itemAt(diceExpectation(hole, rain, wind), key(hole, hole.tee), 'tee cell');
}

/**
 * The cells a player can hole out from, judged by the shots the rules really offer: whatever the die gives, there is
 * a shot that keeps the ball somewhere it can still finish, and the cup stays reachable. Exactly the cells
 * `diceExpectation` values finitely (`tests/carry.test.ts` holds the two together), found by elimination instead of
 * value iteration so the builder can ask it for every wind and rain in the time of one tap.
 *
 * Water and trees are not walls here — a hit flies over water, and over trees from the fairway — so a tee and a cup
 * with a river between them are connected when some shot carries it, which is the whole question the builder asks.
 *
 * Two conditions, applied until they stop removing cells: a cell is kept while *every* roll offers a shot into the
 * cells still kept (no roll strands the ball), and while *some* roll offers a shot into the cells already known to
 * reach the cup (so a pocket whose shots only ever lead back into the pocket is not mistaken for a playable one).
 */
export function finishableCells(hole: Hole, wind: Wind = CALM, rain = false): Set<number> {
  const cells = landableCells(hole);
  const options = optionSets(hole, cells, wind, rain);
  const cup = key(hole, hole.cup);
  let kept = new Set(cells.map((p) => key(hole, p)));
  for (;;) {
    const reaches = new Set<number>([cup]);
    for (let grew = true; grew; ) {
      grew = false;
      cells.forEach((p, i) => {
        const k = key(hole, p);
        if (reaches.has(k) || !kept.has(k)) return;
        const byRoll = itemAt(options, i, 'option set');
        const stays = (o: number) => o === HOLED || kept.has(o);
        const closer = (o: number) => o === HOLED || reaches.has(o);
        if (!byRoll.every((outs) => outs.some(stays)) || !byRoll.some((outs) => outs.some(closer))) return;
        reaches.add(k);
        grew = true;
      });
    }
    // `reaches` is only ever a subset of `kept`: equal sizes mean nothing more can be removed.
    if (reaches.size === kept.size) return reaches;
    kept = reaches;
  }
}

/** Cells reachable from `start` by putting alone (a putt is always allowed); `rain` keeps slopes from rolling them on. */
export function puttComponent(hole: Hole, start: P, rain = false): Set<number> {
  const seen = new Set<number>([key(hole, start)]);
  const stack = [start];
  for (let p = stack.pop(); p; p = stack.pop()) {
    for (const m of legalMoves(hole, p, 1, CALM, rain)) {
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
