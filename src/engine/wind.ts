import { itemAt } from './assert';
import { mulberry32, pick, type Rng } from './rng';
import { CALM, DIR_NAMES, type Dir, type Wind } from './types';

/** Calm about 15% of holes, strength 2 about 15%, strength 1 the rest. */
const CALM_CHANCE = 0.15;
const STRONG_CHANCE = 0.15;

const ALL_DIRS: readonly Dir[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** One wind: strength 0, 1 or 2, and when it blows any of the 8 directions with equal chance. */
export function rollWind(rng: Rng): Wind {
  const r = rng();
  if (r < CALM_CHANCE) return CALM;
  const strength = r < 1 - STRONG_CHANCE ? 1 : 2;
  return { strength, dir: pick(rng, ALL_DIRS) };
}

/** The wind on hole `holeIndex` (0-based) of `course` in the round with this wind seed: the same every time. */
export function windForHole(seed: number, course: number, holeIndex: number): Wind {
  const mixed = (seed ^ Math.imul(course + 1, 0x9e3779b1) ^ Math.imul(holeIndex + 1, 0x85ebca6b)) >>> 0;
  return rollWind(mulberry32(mixed));
}

/**
 * Every wind a hole can be dealt: calm, then strengths 1 and 2 in all eight directions. A hole has to play in all of
 * them, which is what the builder holds a forced carry to (`whyUnplayable` in `src/engine/builder.ts`).
 */
export const EVERY_WIND: readonly Wind[] = [
  CALM,
  ...([1, 2] as const).flatMap((strength) => ALL_DIRS.map((dir): Wind => ({ strength, dir }))),
];

/** Where the wind blows to and how hard, e.g. "NE 2"; empty when calm. */
export const windReading = (w: Wind) => (w.strength === 0 ? '' : `${itemAt(DIR_NAMES, w.dir, 'wind direction')} ${String(w.strength)}`);

/** "Wind NE 2", or "Calm". */
export const windLabel = (w: Wind) => (w.strength === 0 ? 'Calm' : `Wind ${windReading(w)}`);
