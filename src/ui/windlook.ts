import { randRange, chance, type Rng } from '../engine/rng';
import { DIRS, type Dir, type Wind } from '../engine/types';
import type { Bounds } from './flight';

/**
 * How the wind looks: pencil swirls across the board, swaying trees and a fluttering flag. Pure visual parameters
 * (no DOM, no gameplay): the animation in `swirls.ts` and the sway in `board.ts` only read them. Distances are in
 * board units (1 = one grid space).
 */
export interface WindLook {
  /** Strokes on the board at a time (about). */
  strokes: number;
  /** Seconds a stroke takes to cross the board, head in to tail out: [quickest, slowest]. */
  crossSec: readonly [number, number];
  /** Length of the drawn trail behind the head. */
  length: number;
  /** Side-to-side wave of a stroke, and the wave's length along it. */
  amplitude: number;
  wavelength: number;
  /** Chance a stroke curls into a small loop partway, and that loop's radius. */
  curlChance: number;
  curlRadius: number;
  /** Peak pencil opacity (at the head) and line width. */
  alpha: number;
  width: number;
  /** Trees lean and sway up to this many degrees, one sway taking `swaySec`. */
  treeSwayDeg: number;
  swaySec: number;
  /** How hard the flag flutters (0 = still), one flap taking `flagSec`. */
  flagFlutter: number;
  flagSec: number;
}

const STILL: WindLook = {
  strokes: 0,
  crossSec: [0, 0],
  length: 0,
  amplitude: 0,
  wavelength: 1,
  curlChance: 0,
  curlRadius: 0,
  alpha: 0,
  width: 0,
  treeSwayDeg: 0,
  swaySec: 0,
  flagFlutter: 0,
  flagSec: 0,
};

const LOOKS: Record<1 | 2, WindLook> = {
  1: {
    strokes: 3,
    crossSec: [6, 8],
    length: 3,
    amplitude: 0.2,
    wavelength: 2.8,
    curlChance: 0.25,
    curlRadius: 0.32,
    alpha: 0.55,
    width: 0.07,
    treeSwayDeg: 1.25,
    swaySec: 2.6,
    flagFlutter: 0.12,
    flagSec: 0.8,
  },
  2: {
    strokes: 9,
    crossSec: [2.5, 3.5],
    length: 3.8,
    amplitude: 0.28,
    wavelength: 2.1,
    curlChance: 0.25,
    curlRadius: 0.36,
    alpha: 0.58,
    width: 0.075,
    treeSwayDeg: 3,
    swaySec: 1.3,
    flagFlutter: 0.26,
    flagSec: 0.36,
  },
};

/** The look of this wind: still when calm. */
export const windLook = (w: Wind): WindLook => (w.strength === 0 ? STILL : LOOKS[w.strength]);

/** The unit vector the wind blows towards (N is up the page). */
export function windVector(dir: Dir): { x: number; y: number } {
  const d = DIRS[dir];
  const n = Math.hypot(d.x, d.y);
  return { x: d.x / n, y: d.y / n };
}

/** One travelling stroke: its head runs `travel` units from `origin` along `along` at `speed` units a second. */
export interface Swirl {
  origin: { x: number; y: number };
  along: { x: number; y: number };
  /** Left of `along`: the side the wave and the curl swing to. */
  side: { x: number; y: number };
  speed: number;
  travel: number;
  amplitude: number;
  wavelength: number;
  phase: number;
  /** Where along its run the loop starts, how long a run it takes, its radius and which side it swings; null: none. */
  curl: { at: number; span: number; r: number; turn: 1 | -1 } | null;
  /** Hand-drawn wobble phases. */
  jitter: readonly [number, number];
}

/** How far past the board's edge a stroke starts and ends, so it slides in and out rather than popping. */
const MARGIN = 0.6;

/**
 * A new stroke for this wind: its head off the upwind edge at a random spot across the board, crossing to the far
 * side in `look.crossSec` seconds. Uses only `rng` (never the game's), so it is purely visual.
 */
export function spawnSwirl(rng: Rng, look: WindLook, board: Bounds, dir: Dir): Swirl {
  const along = windVector(dir);
  const side = { x: along.y, y: -along.x };
  // The board's extent along the wind.
  const depth = board.w * Math.abs(along.x) + board.h * Math.abs(along.y);
  // Through a random spot on the board, so a diagonal wind's strokes cross it rather than clip a corner.
  const across = (randRange(rng, 0.5, board.w - 0.5) - board.w / 2) * side.x + (randRange(rng, 0.5, board.h - 0.5) - board.h / 2) * side.y;
  const back = depth / 2 + MARGIN;
  const origin = {
    x: board.w / 2 - along.x * back + side.x * across,
    y: board.h / 2 - along.y * back + side.y * across,
  };
  const travel = depth + 2 * MARGIN + look.length;
  const speed = travel / randRange(rng, look.crossSec[0], look.crossSec[1]);
  const amplitude = look.amplitude * randRange(rng, 0.7, 1.2);
  const wavelength = look.wavelength * randRange(rng, 0.8, 1.25);
  const phase = rng() * Math.PI * 2;
  const curled = chance(rng, look.curlChance);
  const r = look.curlRadius * randRange(rng, 0.8, 1.15);
  // The loop's run is short enough to double back on itself (2πr/span > 1), and lands mid-board.
  const turn: 1 | -1 = chance(rng, 0.5) ? 1 : -1;
  const curl = curled ? { at: travel * randRange(rng, 0.3, 0.55), span: r * randRange(rng, 3.2, 4), r, turn } : null;
  return { origin, along, side, speed, travel, amplitude, wavelength, phase, curl, jitter: [rng() * 6.3, rng() * 6.3] };
}

/**
 * Mean seconds between new strokes so that about `look.strokes` are on the board at once: a stroke is on it from its
 * head crossing the near edge to its tail crossing the far one, a chord through a random spot (shorter than the
 * board's full depth on a diagonal), and its run also slides in and out past the edges.
 */
export function spawnEverySec(look: WindLook, board: Bounds, dir: Dir): number {
  if (look.strokes === 0) return Infinity;
  const along = windVector(dir);
  const depth = board.w * Math.abs(along.x) + board.h * Math.abs(along.y);
  const travel = depth + 2 * MARGIN + look.length;
  const mean = (look.crossSec[0] + look.crossSec[1]) / 2;
  // The mean chord through the spots a stroke can be aimed at (spawnSwirl), sampled on a fine grid.
  const N = 24;
  let sum = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = 0.5 + ((i + 0.5) / N) * (board.w - 1);
      const y = 0.5 + ((j + 0.5) / N) * (board.h - 1);
      sum += chord(board, x, y, along);
    }
  return (mean * (sum / (N * N) + look.length)) / travel / look.strokes;
}

/** Length of the board's chord through (x, y) along unit vector `d`. */
function chord(board: Bounds, x: number, y: number, d: { x: number; y: number }): number {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [p, v, size] of [
    [x, d.x, board.w],
    [y, d.y, board.h],
  ] as const) {
    if (Math.abs(v) < 1e-9) continue;
    const a = -p / v;
    const b = (size - p) / v;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  return Math.max(0, hi - lo);
}

/** Where a stroke is drawn when its head has run `u` units: along the wind, waving side to side, maybe looping. */
export function swirlPoint(s: Swirl, u: number): { x: number; y: number } {
  let fwd = u;
  let lat = s.amplitude * Math.sin((u / s.wavelength) * Math.PI * 2 + s.phase);
  // A pencil hand never runs perfectly smooth.
  lat += 0.012 * (Math.sin(u * 9.1 + s.jitter[0]) + 0.5 * Math.sin(u * 23.7 + s.jitter[1]));
  const c = s.curl;
  if (c && u > c.at && u < c.at + c.span) {
    // One turn of a prolate cycloid: it runs back on itself and loops.
    const th = ((u - c.at) / c.span) * Math.PI * 2;
    fwd -= c.r * Math.sin(th);
    lat += c.turn * c.r * (1 - Math.cos(th));
  }
  return {
    x: s.origin.x + s.along.x * fwd + s.side.x * lat,
    y: s.origin.y + s.along.y * fwd + s.side.y * lat,
  };
}
