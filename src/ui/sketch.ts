import { mulberry32 } from '../engine/rng';
import type { P } from '../engine/types';
import { windControl, type Bounds } from './flight';

/** Hand-drawn SVG path helpers. Coordinates are in board units (1 = one grid space). */

export const center = (p: P) => ({ x: p.x + 0.5, y: p.y + 0.5 });

/** A slightly bowed pencil stroke between two dots. */
export function wobblyLine(a: P, b: P, seed: number): string {
  const rng = mulberry32(seed);
  const A = center(a);
  const B = center(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = (rng() - 0.5) * Math.min(0.35, 0.06 * len + 0.05);
  const m1 = 0.3 + rng() * 0.1;
  const m2 = 0.6 + rng() * 0.1;
  const j = () => (rng() - 0.5) * 0.04;
  const c1 = { x: A.x + dx * m1 + nx * bow + j(), y: A.y + dy * m1 + ny * bow + j() };
  const c2 = { x: A.x + dx * m2 + nx * bow * 0.8 + j(), y: A.y + dy * m2 + ny * bow * 0.8 + j() };
  return `M${f(A.x)} ${f(A.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(B.x + j())} ${f(B.y + j())}`;
}

/**
 * A shot bent by the wind: a pencil curve that leaves `from` heading for `aim` (where it was aimed and touches down)
 * and bends onto `end`, the square the wind leaves it on. It ends exactly on `end`; only the middle wavers a little.
 */
export function windCurve(from: P, aim: P, end: P, seed: number, bounds: Bounds): string {
  const rng = mulberry32(seed);
  const A = center(from);
  const B = center(end);
  const C = center(windControl(from, aim, bounds));
  const j = () => (rng() - 0.5) * 0.04;
  return `M${f(A.x)} ${f(A.y)} Q${f(C.x + j())} ${f(C.y + j())} ${f(B.x)} ${f(B.y)}`;
}

/** The dots a rolled ball passed through from `landing`: its slope chain, or just `end` (older saves). */
export const rollDots = (s: { landing: P; end: P; rolls?: P[] }): P[] => [s.landing, ...(s.rolls?.length ? s.rolls : [s.end])];

/** A slope roll (or a chain of them) as pencil strokes from dot to dot. */
export function rollLine(dots: P[], seed: number): string {
  return dots
    .slice(1)
    .map((b, i) => wobblyLine(dots[i] ?? b, b, seed + i))
    .join(' ');
}

/** A quick pencil circle: a little more than one turn with a wavering radius. */
export function sketchCircle(p: P, r: number, seed: number): string {
  const rng = mulberry32(seed);
  const C = center(p);
  const start = rng() * Math.PI * 2;
  const turns = 1.12 + rng() * 0.1;
  const steps = 28;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (i / steps) * turns * Math.PI * 2;
    const rr = r * (1 + 0.1 * Math.sin(a * 2 + start) + (i / steps) * 0.08);
    pts.push(`${i ? 'L' : 'M'}${f(C.x + Math.cos(a) * rr)} ${f(C.y + Math.sin(a) * rr * 0.95)}`);
  }
  return pts.join(' ');
}

const f = (n: number) => n.toFixed(3);
