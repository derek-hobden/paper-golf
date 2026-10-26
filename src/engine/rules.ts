import { gridAt } from './grid';
import { CALM, DIRS, type Cell, type Dir, type Hole, type P, type Wind } from './types';

/** The sign the game writes a negative number with (as in "In the sand: −1"): a minus, not a hyphen. */
const MINUS = '−';

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

/**
 * How high the ground is at `p`: `1` a plateau, `-1` a dip, 0 level. Level is the default, on the page and off it, so
 * every hole drawn, saved or linked before elevation plays exactly as it always did.
 */
export function heightAt(hole: Hole, p: P): number {
  return inBounds(hole, p) ? (cellAt(hole, p).z ?? 0) : 0;
}

/** What elevation did to one hit. Present on a hit the ground moved, absent on a level one and on every putt. */
export interface Elevation {
  /** The climb from the ball to the dot the hit would have come down on: `1` a level up, `-2` two levels down. */
  climb: number;
  /** What that did to the carry: `-1` one dot shorter, `2` two dots longer. Never past a carry of 1 dot. */
  shift: number;
  /** Where the same hit comes down on level ground: the dashed ring behind the marker that moved. */
  level: P;
}

/**
 * Elevation on one hit: it carries its normal distance (the roll, the lie, the rain) less the climb from the ball to
 * the dot it would have come down on — uphill is shorter, downhill longer — and never less than 1 dot. Only that
 * dot's height counts: the dot the adjusted hit reaches is never measured again, so there is no second pass. It is
 * worked out per direction, so the markers round one ball can move by different amounts, and before the wind and any
 * slope roll, which then play exactly as they always have. Putts are never affected. Null when the carry does not move.
 */
export function hitElevation(hole: Hole, from: P, dir: Dir, dist: number): Elevation | null {
  const level = step(from, dir, dist);
  const climb = heightAt(hole, level) - heightAt(hole, from);
  const carry = Math.max(1, dist - climb);
  return carry === dist ? null : { climb, shift: carry - dist, level };
}

/** What a shift did to the carry, for a marker on a phone: "1 longer", "2 shorter". */
export function carryNote(shift: number): string {
  return `${String(Math.abs(shift))} ${shift > 0 ? 'longer' : 'shorter'}`;
}

/** The sticker on the marker a hit moved: "+1 uphill · 1 shorter", "−2 downhill · 2 longer". */
export function elevationNote(elev: Elevation): string {
  const climb = elev.climb > 0 ? `+${String(elev.climb)} uphill` : `${MINUS}${String(Math.abs(elev.climb))} downhill`;
  return `${climb} · ${carryNote(elev.shift)}`;
}

/** The tray's one line when every direction moves the same way: "Downhill all round · 1 longer". */
export function elevationAllRound(elev: Elevation): string {
  return `${elev.climb > 0 ? 'Uphill' : 'Downhill'} all round · ${carryNote(elev.shift)}`;
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
  /** Present on a hit the ground's height moved: how far it climbed and where a level hit would have come down. */
  elev?: Elevation;
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
 *
 * `elevated` says this shot is a hit, which the ground's height carries further or cuts short (`hitElevation`) before
 * any of the above: the whole flight, the cup included, is then the adjusted one. Putts are played without it.
 */
export function resolveShot(
  hole: Hole,
  from: P,
  dir: Dir,
  dist: number,
  wind: Wind = CALM,
  rain = false,
  elevated = false,
): ShotResult {
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
  const elev = elevated ? hitElevation(hole, from, dir, dist) : null;
  /** What the hit really carries: the elevation is worked out once, from the distance the roll and the lie gave. */
  const carry = dist + (elev?.shift ?? 0);
  const shot = (r: ShotResult): ShotResult => (elev ? { ...r, elev } : r);
  for (let k = 1; k < carry; k++) {
    const p = step(from, dir, k);
    if (samePos(p, hole.cup) && k >= carry - 1) return shot({ legal: true, holed: true, landing: p, end: p, rolled: false });
    // Off the page in flight: the touchdown is off it too (a straight line), which only the wind can bring back.
    if (!inBounds(hole, p)) {
      if (blows) continue;
      return fail('offgrid', p);
    }
    if (cellAt(hole, p).t === 'tree' && !fromFairway) return fail('trees', p);
  }
  const landing = step(from, dir, carry);
  if (samePos(landing, hole.cup)) return shot({ legal: true, holed: true, landing, end: landing, rolled: false });
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
  const result: ShotResult = shot({ legal: true, holed: false, landing, end: rest, rolled: false });
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

export interface Move {
  dir: Dir;
  dist: number;
  result: ShotResult;
}

/**
 * Every legal shot of `dist` spaces from `from`. `elevated` says these are hits, which the ground's height carries
 * further or cuts short per direction (`hitElevation`); `dist` stays the distance the roll and the lie gave, so a
 * move's own `dist` is the number the tray reads out and `m.result.end` is where the ball really stops.
 */
export function legalMoves(hole: Hole, from: P, dist: number, wind: Wind = CALM, rain = false, elevated = false): Move[] {
  const out: Move[] = [];
  if (dist < 1) return out;
  for (let d = 0; d < 8; d++) {
    const result = resolveShot(hole, from, d as Dir, dist, wind, rain, elevated);
    if (result.legal) out.push({ dir: d as Dir, dist, result });
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
 * The one elevation every hit on offer shares — a ball on a plateau with lower ground all round it, say — or null
 * when they differ, when none of them moved, or when there is only one hit to go at (one marker is better told by its
 * own tag than by a line about every direction). What the tray says once instead of tagging every marker.
 */
export function sharedElevation(moves: readonly RollMove[]): Elevation | null {
  const hits = moves.filter((m) => m.kind === 'hit');
  const first = hits[0]?.result.elev;
  if (hits.length < 2 || !first) return null;
  return hits.every((m) => m.result.elev?.shift === first.shift) ? first : null;
}

/**
 * Every legal shot from `from` after rolling `roll`: the 1-dot putt, plus either the green putt the roll earns
 * (on the green) or a hit of the dice distance (off it, a greenside bunker included — sand is never on the green,
 * so the hit out of it is the roll less one). Shared by the game and the solver. The `wind` moves hits
 * only: putts (on the green or the 1-dot putt from anywhere) are never blown. `rain` shortens the hit by one space
 * (`rainDistance`) and keeps every slope from rolling the ball on; the putts it earns are the same as in the dry.
 * The ground's height moves hits only, per direction and after the rain (`hitElevation`); no putt is ever affected.
 */
export function movesForRoll(hole: Hole, from: P, roll: number, wind: Wind = CALM, rain = false): RollMove[] {
  const out: RollMove[] = legalMoves(hole, from, 1, CALM, rain).map((m) => ({ ...m, kind: 'putt' as const }));
  if (onGreen(hole, from)) {
    const len = greenPuttLength(roll);
    if (len > 1) out.push(...puttMoves(hole, from, len, rain).map((m) => ({ ...m, kind: 'putt' as const })));
    return out;
  }
  const dist = diceDistance(hole, from, roll, rain);
  if (dist > 1) out.push(...legalMoves(hole, from, dist, wind, rain, true).map((m) => ({ ...m, kind: 'hit' as const })));
  return out;
}
