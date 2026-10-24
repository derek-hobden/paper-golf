import { randRange, type Rng } from '../engine/rng';
import type { Bounds } from './flight';

/**
 * How the water droplets on the camera lens look: where one lands, how long it clings before it trickles down, the
 * stop-start way it runs and how it wears away on the way. Pure visual parameters (no DOM, no gameplay): the
 * animation in `droplets.ts` only reads them, as `rain.ts` reads `rainlook.ts`.
 *
 * Distances are in CSS pixels, not board units: the lens is the screen the game is watched through, so a bead is the
 * same size whatever the hole is scaled to.
 */
export interface DropletLook {
  /** Beads on the lens at once, at most. 0: none at all. */
  most: number;
  /** Mean seconds between new beads: occasional, one every several seconds. */
  everySec: number;
  /** A bead's radius where it lands: [smallest, largest]. Small, and varied. */
  radius: readonly [number, number];
  /** Seconds it clings there before it starts to run: [least, most]. */
  clingSec: readonly [number, number];
  /** How fast it runs then, before the hesitations: [slowest, quickest] pixels a second. */
  speed: readonly [number, number];
  /**
   * How stop-start the run is: 0 slides steadily, 1 comes to a stop between spurts. Two hesitations share it, so a
   * bead slows almost to a halt and runs on again without ever creeping back up the screen.
   */
  stutter: number;
  /** How often it hesitates: [slowest, quickest] spurts a second. */
  stutterHz: readonly [number, number];
  /** How far it wanders to the side as it runs (pixels), over a wave this many pixels long. */
  wander: number;
  wanderOver: number;
  /** Pixels of running that wear a bead away to nothing: it leaves itself behind as the trail. */
  shrinkOver: number;
  /** A bead this small (pixels) has gone. */
  gone: number;
  /** The wet trail behind it: how wide beside the bead (of its radius), and how long it takes to fade. */
  trailWidth: number;
  trailFadeSec: number;
  /** Peak opacity of a bead and of its trail: the hole always reads through both. */
  alpha: number;
  trailAlpha: number;
}

/** Rain on the lens: a bead every few seconds, never more than three, none of them big. */
const DROPS: DropletLook = {
  most: 3,
  everySec: 5.2,
  radius: [4.5, 11],
  clingSec: [0.5, 2.4],
  speed: [26, 82],
  stutter: 0.92,
  stutterHz: [0.55, 1.9],
  wander: 3.2,
  wanderOver: 110,
  shrinkOver: 620,
  gone: 1.5,
  trailWidth: 0.42,
  trailFadeSec: 1.2,
  alpha: 0.92,
  trailAlpha: 0.3,
};

const NONE: DropletLook = { ...DROPS, most: 0, everySec: Infinity };

/** How much sooner the next bead lands per point of wind strength: a wind-driven rain throws a few more at the lens. */
const WINDIER = 0.17;

/** The look of this weather: a dry hole never beads the lens. */
export const dropletLook = (rain: boolean, strength: 0 | 1 | 2): DropletLook =>
  rain ? { ...DROPS, everySec: DROPS.everySec / (1 + WINDIER * strength) } : NONE;

/**
 * The bead's optics, in fractions of its radius and of full opacity. A drop of water on a lens is read by its edges,
 * never by a fill: the middle is clear and magnifies what is behind it, light bends away from the rim into a soft dark
 * ring, gathers in a bright crescent on the far side, and glints where the light comes from (up and to the left, like
 * the ball's and the die's highlights). `droplets.ts` paints one sprite from these and scales it per bead.
 */
export interface BeadOptics {
  /** How much brighter the magnified middle reads. Nearly clear: the course has to show through. */
  lift: number;
  /** Where the dark rim sits (1 = the bead's edge) and how dark it gets. */
  rimAt: number;
  rim: number;
  /** The bright crescent light bends into, and where round the rim it runs (1 = the bead's edge). */
  caustic: number;
  causticAt: number;
  /** The glint: how bright, how far towards the light, and how wide. */
  glint: number;
  glintAt: number;
  glintSize: number;
  /** How much a bead stretches lengthways when it is running at full speed. */
  stretch: number;
  /** The trail: the cool shade it leaves, and the brighter wet core down the middle of it. */
  trailShade: number;
  trailCore: number;
}

export const BEAD: BeadOptics = {
  lift: 0.025,
  rimAt: 0.88,
  rim: 0.56,
  caustic: 0.78,
  causticAt: 0.93,
  glint: 0.95,
  glintAt: 0.4,
  glintSize: 0.17,
  stretch: 0.28,
  trailShade: 0.55,
  trailCore: 0.35,
};

/** The cool dark the rim and the trail are shaded with, and the light the glint and the crescent are lit with. */
export const WATER_SHADE = [24, 38, 56] as const;
export const WATER_LIGHT = [255, 255, 255] as const;

/** One wave along a bead's run: `amp` either side, `w` radians per second (or per pixel), from `phase`. */
export interface Wave {
  amp: number;
  w: number;
  phase: number;
}

/** One droplet on the lens: where it landed and how it runs from there. */
export interface Droplet {
  /** Where it landed, in CSS pixels from the lens's top-left, and its radius there. */
  x: number;
  y: number;
  r: number;
  /** Seconds it clings where it landed before it runs. */
  cling: number;
  /** Pixels a second it runs at, before the hesitations. */
  speed: number;
  /** The two hesitations that make the run stop-start (their amplitudes never sum past `look.stutter`). */
  a: Wave;
  b: Wave;
  /** How it wanders to the side, by the pixels it has run rather than by the clock. */
  wander: Wave;
  /** Pixels of running that wear it away to nothing. */
  shrinkOver: number;
  /** Turns its glint a little, so two beads are never quite the same bead. */
  phase: number;
}

/**
 * A new droplet for this rain: somewhere on the lens with the whole bead on it, clinging for a moment, then running at
 * its own pace. Uses only `rng` (never the game's), so it is purely visual.
 */
export function spawnDroplet(rng: Rng, look: DropletLook, lens: Bounds): Droplet {
  const r = randRange(rng, look.radius[0], look.radius[1]);
  const cling = randRange(rng, look.clingSec[0], look.clingSec[1]);
  const speed = randRange(rng, look.speed[0], look.speed[1]);
  // One hesitation does the slow work, the other ruffles it; together they never cancel the run entirely.
  const slow = look.stutter * randRange(rng, 0.5, 0.75);
  const hz = (k: number) => 2 * Math.PI * randRange(rng, look.stutterHz[0] * k, look.stutterHz[1] * k);
  const a: Wave = { amp: slow, w: hz(1), phase: rng() * Math.PI * 2 };
  const b: Wave = { amp: look.stutter - slow, w: hz(1.7), phase: rng() * Math.PI * 2 };
  const wander: Wave = {
    amp: look.wander * randRange(rng, 0.3, 1),
    w: ((2 * Math.PI) / look.wanderOver) * randRange(rng, 0.7, 1.4),
    phase: rng() * Math.PI * 2,
  };
  const margin = look.radius[1] + 1;
  return {
    x: randRange(rng, margin, lens.w - margin),
    // Mostly in the upper two thirds, so there is screen left for it to run down.
    y: randRange(rng, margin + 1, lens.h * 0.75),
    r,
    cling,
    speed,
    a,
    b,
    wander,
    shrinkOver: look.shrinkOver * randRange(rng, 0.8, 1.25),
    phase: rng() * Math.PI * 2,
  };
}

/** A wave's travel from its start: `(amp/w)·(sin(wτ+φ) − sin φ)`, which is 0 at τ = 0. */
const travel = (h: Wave, t: number) => (h.amp / h.w) * (Math.sin(h.w * t + h.phase) - Math.sin(h.phase));

/**
 * Pixels this droplet has run by `t` seconds after it landed: nothing while it clings, then its own speed with both
 * hesitations folded in. The hesitations are the integral of the speed's wobble, so the run only ever goes down.
 */
export function dropletRun(d: Droplet, t: number): number {
  if (t <= d.cling) return 0;
  const s = t - d.cling;
  return d.speed * (s + travel(d.a, s) + travel(d.b, s));
}

/** How fast it is running at `t` (pixels a second): `dropletRun`'s slope, never negative. */
export function dropletSpeed(d: Droplet, t: number): number {
  if (t <= d.cling) return 0;
  const s = t - d.cling;
  return d.speed * (1 + d.a.amp * Math.cos(d.a.w * s + d.a.phase) + d.b.amp * Math.cos(d.b.w * s + d.b.phase));
}

/** Where the bead is at `t` and how much of it is left: straight down the lens, wandering a little, wearing away. */
export function dropletAt(d: Droplet, t: number): { x: number; y: number; r: number } {
  const run = dropletRun(d, t);
  return {
    x: d.x + d.wander.amp * (Math.sin(d.wander.w * run + d.wander.phase) - Math.sin(d.wander.phase)),
    y: d.y + run,
    r: d.r * Math.max(0, 1 - run / d.shrinkOver),
  };
}

/** Whether it is over: worn away to nothing, or run off the bottom of the lens. */
export function dropletGone(d: Droplet, look: DropletLook, lens: Bounds, t: number): boolean {
  const { y, r } = dropletAt(d, t);
  return r <= look.gone || y - r > lens.h;
}
