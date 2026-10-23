import { mulberry32, type Rng } from './rng';

/** Rain falls on about one hole in five. */
const RAIN_CHANCE = 0.2;

/** Whether it rains: one roll of its own, so a rainy hole is as likely to be calm as windy. */
export function rollRain(rng: Rng): boolean {
  return rng() < RAIN_CHANCE;
}

/**
 * Whether hole `holeIndex` (0-based) of `course` is rainy in the round with this rain seed: the same every time.
 * Mixed with its own constants, so rain and wind never march together even when both seeds are 0.
 */
export function rainForHole(seed: number, course: number, holeIndex: number): boolean {
  const mixed = (seed ^ Math.imul(course + 1, 0x7feb352d) ^ Math.imul(holeIndex + 1, 0x846ca68b)) >>> 0;
  return rollRain(mulberry32(mixed));
}

/** "Rain" on a rainy hole, empty when it is dry (the HUD shows it beside the wind). */
export const rainLabel = (rain: boolean) => (rain ? 'Rain' : '');
