/**
 * Pure timing for a shot animation (no DOM): the ball's flight profile and the order of the steps, so the
 * sequence can be unit-tested and `Fx`/`main` only have to play it.
 */

/** Where the ball is at one moment of a shot: `along` the ground line (0 = start, 1 = target) and its `lift` (px). */
export interface FlightPos {
  along: number;
  lift: number;
}

/** One segment of the flight: the ball moves along [from, to] and hops to `height` (0 = rolling on the ground). */
export interface FlightLeg {
  from: number;
  to: number;
  height: number;
  dur: number;
}

/** The ball carries this far along the line before its first bounce, then bounces and rolls out the rest. */
export const CARRY = 0.83;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuad = (t: number) => 1 - (1 - t) ** 2;

/**
 * Legs of a full shot: a high carry to ~83% of the line, two small decaying bounces that keep moving forward, then
 * a short roll-out that stops exactly on the target. About 0.9–1.1 s in all. A putt is a single ground-level leg.
 * `cell` is the board's cell size in px; `dist` the shot length in cells.
 */
export function flightLegs(dist: number, cell: number, putt: boolean): FlightLeg[] {
  if (putt) return [{ from: 0, to: 1, height: 0, dur: 520 }];
  const apex = cell * (0.8 + dist * 0.42);
  const hop = Math.min(apex * 0.16, cell * 0.75);
  return [
    { from: 0, to: CARRY, height: apex, dur: 520 + dist * 50 },
    { from: CARRY, to: 0.93, height: hop, dur: 190 },
    { from: 0.93, to: 0.975, height: hop * 0.35, dur: 120 },
    { from: 0.975, to: 1, height: 0, dur: 150 },
  ];
}

export const flightDuration = (legs: FlightLeg[]) => legs.reduce((s, l) => s + l.dur, 0);

/** Position within one leg at local time t (0..1). Hops are symmetric parabolas; ground legs ease out to a stop. */
export function legPos(leg: FlightLeg, t: number): FlightPos {
  const u = Math.min(1, Math.max(0, t));
  if (leg.height <= 0) {
    if (u >= 1) return { along: leg.to, lift: 0 };
    return { along: leg.from + (leg.to - leg.from) * easeOutCubic(u), lift: 0 };
  }
  // A ball in flight moves at near-constant ground speed; the carry slows a touch into the landing.
  const g = leg.from === 0 ? easeOutQuad(u) * 0.35 + u * 0.65 : u;
  if (u >= 1) return { along: leg.to, lift: 0 };
  return { along: leg.from + (leg.to - leg.from) * g, lift: 4 * leg.height * u * (1 - u) };
}

/** Position over the whole flight at global time t (0..1). Ends exactly on the target with no lift. */
export function flightPos(legs: FlightLeg[], t: number): FlightPos {
  const total = flightDuration(legs);
  let at = Math.min(1, Math.max(0, t)) * total;
  for (const leg of legs) {
    if (at <= leg.dur) return legPos(leg, at / leg.dur);
    at -= leg.dur;
  }
  return { along: 1, lift: 0 };
}

/** A point in any one linear space (grid dots or screen px: the board's transform keeps Bézier curves intact). */
export interface Pt {
  x: number;
  y: number;
}

/** How far towards the aim point the wind curve's control point sits: far enough to leave heading for the aim, near
 * enough that a headwind's curve never runs past the square the ball stops on. */
export const CURVE_PULL = 0.6;

/** A board's size in dots: dots run 0..w-1 across and 0..h-1 down. */
export interface Bounds {
  w: number;
  h: number;
}

/** How far (0..1) from `a` towards `b` one coordinate can go and stay inside 0..max. */
const reach = (a: number, b: number, max: number) => (b > max ? (max - a) / (b - a) : b < 0 ? a / (a - b) : 1);

/**
 * The control point of a wind-bent shot, in dots: on the line from the ball towards where it was aimed (its
 * touchdown). An aim off the page pulls it in along that same line to the edge, so the curve (which never leaves the
 * triangle of the ball, the control point and its end) stays on the board and still leaves the ball heading for the aim.
 */
export function windControl(from: Pt, aim: Pt, bounds: Bounds): Pt {
  const t = Math.max(0, Math.min(CURVE_PULL, reach(from.x, aim.x, bounds.w - 1), reach(from.y, aim.y, bounds.h - 1)));
  return { x: from.x + (aim.x - from.x) * t, y: from.y + (aim.y - from.y) * t };
}

/**
 * Point `t` (0..1) along a quadratic Bézier from `from` through control `ctrl` to `end`. With `windControl` it leaves
 * the ball heading for the aim point and bends with the wind to finish exactly on the square the ball stops on.
 */
export function curvePoint(from: Pt, ctrl: Pt, end: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * ctrl.x + t * t * end.x, y: u * u * from.y + 2 * u * t * ctrl.y + t * t * end.y };
}

export type ShotStep = 'fly' | 'line' | 'circle' | 'roll' | 'roll-line' | 'lift-pencil' | 'sink' | 'hide-ball';

/**
 * Order of a shot's animation: the ball flies and settles first, only then does the pencil draw its line (and ring
 * the landing spot); a slope roll repeats that pattern. A shot the wind blew flies one curve onto the square it stops
 * on (any slope roll is folded into that curve). The game state is already final when this plays.
 */
export function shotSteps(s: { holed: boolean; rolled: boolean; blown?: boolean }): ShotStep[] {
  const steps: ShotStep[] = ['fly', 'line'];
  const rolled = s.rolled && !s.blown;
  if (!s.holed || rolled) steps.push('circle');
  if (rolled) steps.push('roll', 'roll-line');
  steps.push('lift-pencil', s.holed ? 'sink' : 'hide-ball');
  return steps;
}

/**
 * A one-at-a-time lock for player input: while an animation holds it, taps on targets, rolls, mulligans and the
 * tray tools are ignored.
 */
export class InputLock {
  private held = false;

  get busy() {
    return this.held;
  }

  /** Run `fn` holding the lock; returns false (and does nothing) if something else already holds it. */
  async run(fn: () => Promise<void> | void): Promise<boolean> {
    if (this.held) return false;
    this.held = true;
    try {
      await fn();
    } finally {
      this.held = false;
    }
    return true;
  }
}
