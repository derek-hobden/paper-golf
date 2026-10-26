import { gridAt } from './grid';
import { CALM, DIRS, type Cell, type Dir, type Height, type Hole, type P, type Wind } from './types';

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
  /** The un-winded aim, where the ball comes down when nothing carries it on (in a wind it is only the dot the push
   * starts from, so it may be off the page, or trees a hit from the fairway flies over). */
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
 * 2. Touchdown on `landing`, the un-winded aim. Calm, the ball comes down there, so it must be a dot it can rest on
 *    (on the page, not water or trees). In a wind a hit from the fairway never comes down on trees there — the push
 *    carries it on, so they are one more dot flown over, as earlier in the flight (issue 1). Water on the aim, and
 *    trees on the aim when the hit did not come from the fairway, end the shot as they always have.
 * 3. The wind (`applyWind`) pushes the ball its full vector, over anything in between. The dot it ends on must be one
 *    the ball can rest on (on the page, not water or trees), or the shot is illegal: a touchdown on the page can be
 *    blown off it or into water or trees, and one off the page counts only when the wind brings it back on to such a
 *    dot. Putts are played with `CALM`.
 * 4. Only then do slopes act, from the dot where the ball actually rests, chaining (`rollSlopes`). A slope at the
 *    touchdown matters only when the wind leaves the ball there. The ball holes when it ends on the cup. In the
 *    rain the ground is wet and no slope rolls the ball at all: it stops where it comes to rest.
 */
export function resolveShot(hole: Hole, from: P, dir: Dir, dist: number, wind: Wind = CALM, rain = false): ShotResult {
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
    // Issue 1, and only that case: a hit from the fairway is still in the air over its aim, so a wind carries it on
    // over trees there, exactly as it carries it over trees earlier in the flight. Every other aim is untouched —
    // water always ends the shot, and so do trees when the hit did not come from the fairway (both are open
    // questions for Derek, not decided here).
    if (t === 'tree' && !(blows && fromFairway)) return fail('trees', landing);
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
  // Wet ground: in the rain the ball stays on the dot it came to rest on, whatever the slope under it.
  if (rain) return result;
  const { path, holed } = rollSlopes(hole, rest);
  const last = path.at(-1);
  return last ? { ...result, holed, end: last, rolled: true, rolls: path } : result;
}

/**
 * Heavy air in the rain: the longest hit available is one space shorter than normal, never below 1. A lie that offers
 * no hit at all in the dry (distance 0, sand on a 1) still offers none.
 */
export function rainDistance(dist: number): number {
  return dist > 1 ? dist - 1 : dist;
}

/**
 * Dice hit distance: roll +1 from the fairway, -1 from sand, then one less again in the rain's heavy air
 * (`rainDistance`). May be 0 (then only a putt is possible).
 */
export function diceDistance(hole: Hole, from: P, roll: number, rain = false): number {
  const t = cellAt(hole, from).t;
  const mod = t === 'fairway' ? 1 : t === 'sand' ? -1 : 0;
  const dist = Math.max(0, roll + mod);
  return rain ? rainDistance(dist) : dist;
}

/**
 * The ground's height at `p`: +1 a plateau, −1 a dip, 0 level ground (the page itself). A dot off the page is level —
 * nothing is built out there, and a hit that comes down off the page is judged only by the dot the wind leaves it on.
 */
export function heightAt(hole: Hole, p: P): Height {
  return inBounds(hole, p) ? (cellAt(hole, p).e ?? 0) : 0;
}

/**
 * The climb a hit of `dist` spaces in `dir` would make: the height of the dot it comes down on over level ground,
 * less the height it is played from. +1 is one step uphill, −1 one step downhill, ±2 the full two-level change
 * between a plateau and a dip.
 */
export function climbFor(hole: Hole, from: P, dir: Dir, dist: number): number {
  return heightAt(hole, step(from, dir, dist)) - heightAt(hole, from);
}

/**
 * What the climb does to a hit: uphill carries less, downhill more, by the climb itself, and never below one space.
 * Only the height of the dot the hit would have come down on counts (`climbFor`) — the adjusted landing's own height
 * is never read, so there is no second pass and no chain of heights.
 */
export function elevatedDistance(dist: number, climb: number): number {
  return Math.max(1, dist - climb);
}

export interface Move {
  dir: Dir;
  /** Spaces actually played: for a hit, after elevation (`hitMoves`), which is what `resolveShot` resolved. */
  dist: number;
  result: ShotResult;
  /** The climb this hit made (`climbFor`), when the ground was not level. Absent on a putt and on a level hit. */
  climb?: number;
  /** Where the hit would have come down on level ground, when elevation moved it. Absent when it did not. */
  level?: P;
}

export function legalMoves(hole: Hole, from: P, dist: number, wind: Wind = CALM, rain = false): Move[] {
  const out: Move[] = [];
  if (dist < 1) return out;
  for (let d = 0; d < 8; d++) {
    const result = resolveShot(hole, from, d as Dir, dist, wind, rain);
    if (result.legal) out.push({ dir: d as Dir, dist, result });
  }
  return out;
}

/**
 * The hits a distance of `dist` offers, one per direction, over the hole's heights. The climb is worked out per
 * direction (`climbFor`), so one roll can offer markers at different distances: a direction that goes uphill plays
 * shorter, one that goes downhill longer (`elevatedDistance`).
 *
 * Elevation comes first and `resolveShot` then plays the adjusted distance exactly as it always has, so the wind
 * pushes from the adjusted touchdown, the slopes roll on from where the ball rests, the path holes through the cup
 * and the dot it ends on decides whether the shot is offered at all. Putts never climb: `legalMoves` and `puttMoves`
 * are untouched, which keeps the putting rules near the cup as they are.
 */
export function hitMoves(hole: Hole, from: P, dist: number, wind: Wind = CALM, rain = false): Move[] {
  const out: Move[] = [];
  if (dist < 1) return out;
  for (let d = 0; d < 8; d++) {
    const dir = d as Dir;
    const climb = climbFor(hole, from, dir, dist);
    const played = elevatedDistance(dist, climb);
    const result = resolveShot(hole, from, dir, played, wind, rain);
    if (!result.legal) continue;
    const move: Move = { dir, dist: played, result };
    // A hit whose distance the clamp left where it was has not moved, so it carries no climb and no ghost landing.
    if (climb !== 0 && played !== dist) {
      move.climb = climb;
      move.level = step(from, dir, dist);
    }
    out.push(move);
  }
  return out;
}

/** Steps between two cells when moving in the 8 directions (Chebyshev distance). */
export function dotsApart(a: P, b: P): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** How far the green reaches around the cup (diagonals count, like every move). */
export const GREEN_RADIUS = 2;

/** The grass a green is cut from. Sand is a bunker wherever it lies, and no ball ever rests on water or trees. */
export function isGrass(hole: Hole, p: P): boolean {
  const t = cellAt(hole, p).t;
  return t === 'fairway' || t === 'rough';
}

/**
 * The green: grass within `GREEN_RADIUS` dots of the cup. A sand trap inside that ring is a bunker, not green: it
 * keeps the sand lie (−1 on the hit, `diceDistance`) and earns no 2- or 3-dot putt, so a greenside bunker plays as
 * sand everywhere — the lie, the hint and the next shot (Derek, 24 Oct 2026). Water and trees in the ring are not
 * green either, which only the board's drawing can tell: a ball cannot come to rest on them.
 */
export function onGreen(hole: Hole, p: P): boolean {
  return inBounds(hole, p) && dotsApart(p, hole.cup) <= GREEN_RADIUS && isGrass(hole, p);
}

/**
 * A ball resting this close to the cup is putted in automatically: the 1-dot putt is allowed from any lie, and from
 * one dot out it always holes, so sand next to the cup taps in like grass.
 */
export const isTapIn = (hole: Hole, p: P) => dotsApart(p, hole.cup) === 1;

/**
 * On the green you may only putt. Besides the 1-dot putt (always allowed), the die can earn a longer putt: a roll of
 * exactly 2 allows a 2-dot putt, a roll of exactly 3 a 3-dot putt; any other roll leaves only the 1-dot putt. The
 * fairway's +1 does not apply to putts (nor does sand's -1: a bunker is never on the green, `onGreen`).
 */
export function greenPuttLength(roll: number): number {
  return roll === 2 || roll === 3 ? roll : 1;
}

/**
 * Putts of `dist` dots: straight shots that stay on the ground, so every dot rolled over before the ball stops (or
 * drops) must be one it could rest on (no rolling through water or trees). Same holing rules as any shot.
 */
export function puttMoves(hole: Hole, from: P, dist: number, rain = false): Move[] {
  return legalMoves(hole, from, dist, CALM, rain).filter((m) => {
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
 * (on the green) or a hit of the dice distance (off it, a greenside bunker included — sand is never on the green,
 * so the hit out of it is the roll less one). Shared by the game and the solver. The `wind` moves hits
 * only: putts (on the green or the 1-dot putt from anywhere) are never blown. `rain` shortens the hit by one space
 * (`rainDistance`) and keeps every slope from rolling the ball on; the putts it earns are the same as in the dry.
 *
 * The hit then takes the ground's heights per direction (`hitMoves`), after the lie and the rain have set its
 * distance. A lie that offers no hit at all offers none however the ground falls away: a distance of 1 is the putt,
 * so it is the roll, the lie and the rain — never a slope down off a plateau — that decide whether a hit is on offer.
 */
export function movesForRoll(hole: Hole, from: P, roll: number, wind: Wind = CALM, rain = false): RollMove[] {
  const out: RollMove[] = legalMoves(hole, from, 1, CALM, rain).map((m) => ({ ...m, kind: 'putt' as const }));
  if (onGreen(hole, from)) {
    const len = greenPuttLength(roll);
    if (len > 1) out.push(...puttMoves(hole, from, len, rain).map((m) => ({ ...m, kind: 'putt' as const })));
    return out;
  }
  const dist = diceDistance(hole, from, roll, rain);
  if (dist > 1) out.push(...hitMoves(hole, from, dist, wind, rain).map((m) => ({ ...m, kind: 'hit' as const })));
  return out;
}
