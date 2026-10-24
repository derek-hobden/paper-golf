import { randRange, type Rng } from '../engine/rng';
import { DIRS, type Wind } from '../engine/types';
import type { Bounds } from './flight';

/**
 * How the rain looks: light blue pencil streaks falling across the board, leaning downwind. Pure visual parameters (no
 * DOM, no gameplay): the animation in `rain.ts` only reads them, as `swirls.ts` reads `windlook.ts`. Distances are in
 * board units (1 = one grid space).
 */
export interface RainLook {
  /** Streaks on the board at a time (about). */
  streaks: number;
  /** Seconds a streak takes to cross the board, head in to tail out: [quickest, slowest]. */
  fallSec: readonly [number, number];
  /** Length of the drawn streak. */
  length: number;
  /** The pencil the streaks are drawn with, as red, green and blue (`pencil.ts` tiles it with the paper's tooth). */
  color: readonly [number, number, number];
  /** Peak pencil opacity (at the head) and line width. */
  alpha: number;
  width: number;
  /** Sideways lean per unit fallen, at wind strength 1 (strength 2 leans twice as far). */
  lean: number;
}

/**
 * Rain blue: a soft, cool pencil blue rather than the pencil grey the streaks used to fall in. Light enough, at
 * `SHOWER.alpha`, that the fairway, the green and the hazards all read underneath.
 */
const RAIN_BLUE = [116, 174, 226] as const;

/** A shower: enough streaks to read as rain over the grass, light and quick, never hiding the course under it. */
const SHOWER: RainLook = {
  streaks: 26,
  fallSec: [1.1, 1.7],
  length: 1.2,
  color: RAIN_BLUE,
  alpha: 0.42,
  width: 0.045,
  lean: 0.22,
};

const DRY: RainLook = { ...SHOWER, streaks: 0 };

/** The look of this weather: nothing falling on a dry hole. */
export const rainLook = (rain: boolean): RainLook => (rain ? SHOWER : DRY);

/** The unit vector the rain falls along: down the page, leaned downwind by the wind's sideways push. */
export function rainVector(wind: Wind, look: RainLook = SHOWER): { x: number; y: number } {
  const lean = look.lean * DIRS[wind.dir].x * wind.strength;
  const n = Math.hypot(lean, 1);
  return { x: lean / n, y: 1 / n };
}

/** One falling streak: its head runs `travel` units from `origin` along `along` at `speed` units a second. */
export interface Streak {
  origin: { x: number; y: number };
  along: { x: number; y: number };
  speed: number;
  travel: number;
  /** Varies the pencil pressure along the line. */
  phase: number;
}

/** How far past the board's edge a streak starts and ends, so it slides in and out rather than popping. */
const MARGIN = 0.5;

/**
 * A new streak for this shower: its head off the upwind edge through a random spot on the board, crossing it in
 * `look.fallSec` seconds. Uses only `rng` (never the game's), so it is purely visual.
 */
export function spawnStreak(rng: Rng, look: RainLook, board: Bounds, wind: Wind): Streak {
  const along = rainVector(wind, look);
  const side = { x: along.y, y: -along.x };
  // The board's extent along the fall, and a spot on the board to aim the streak through.
  const depth = board.w * Math.abs(along.x) + board.h * Math.abs(along.y);
  const across = (randRange(rng, 0, board.w) - board.w / 2) * side.x + (randRange(rng, 0, board.h) - board.h / 2) * side.y;
  const back = depth / 2 + MARGIN;
  const origin = {
    x: board.w / 2 - along.x * back + side.x * across,
    y: board.h / 2 - along.y * back + side.y * across,
  };
  // Whatever the lean, the head starts above the page rather than popping into view on it: slide it back up the fall
  // until it is clear of the top edge, and give it that much more to run.
  const lift = Math.max(0, (origin.y + MARGIN) / along.y);
  origin.x -= along.x * lift;
  origin.y -= along.y * lift;
  const travel = depth + 2 * MARGIN + look.length + lift;
  return { origin, along, speed: travel / randRange(rng, look.fallSec[0], look.fallSec[1]), travel, phase: rng() * Math.PI * 2 };
}

/**
 * Mean seconds between new streaks so that about `look.streaks` are falling at once: a streak is on the board for
 * roughly one crossing, so spawning one every crossing / `streaks` keeps that many in the air.
 */
export function spawnEverySec(look: RainLook): number {
  if (look.streaks === 0) return Infinity;
  return (look.fallSec[0] + look.fallSec[1]) / 2 / look.streaks;
}

/** Where a streak is drawn when its head has run `u` units: straight along the fall, rain does not wander. */
export function streakPoint(s: Streak, u: number): { x: number; y: number } {
  return { x: s.origin.x + s.along.x * u, y: s.origin.y + s.along.y * u };
}
