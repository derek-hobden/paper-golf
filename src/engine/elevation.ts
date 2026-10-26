/**
 * Elevation in words, and the one question the screens ask about a set of hits: do they all climb the same way?
 * Pure, like `windLabel` and `rainLabel` beside it — the rule itself lives in `rules.ts` (`heightAt`, `climbFor`,
 * `elevatedDistance`, `hitMoves`) and nothing here decides anything about a shot.
 */
import { dotsApart, type Move } from './rules';
import type { P } from './types';

/** The typographic minus the rest of the game reads with ("In the sand: −1"). */
const MINUS = '−';

/**
 * The spaces elevation added to this hit: +1 one space longer (downhill), −1 one shorter (uphill), 0 unchanged. It
 * is the real shift, not the climb, so a hit the one-space floor clamped (a 2-space hit two levels uphill) says the
 * one space it actually lost.
 */
export function shiftOf(from: P, move: Move): number {
  return move.level === undefined ? 0 : move.dist - dotsApart(from, move.level);
}

/** "1 longer", "2 shorter"; empty when nothing moved. The compact tag a phone's markers carry. */
export function liftTag(shift: number): string {
  if (shift === 0) return '';
  return `${String(Math.abs(shift))} ${shift > 0 ? 'longer' : 'shorter'}`;
}

/** "+1 uphill · 1 shorter", "−2 downhill · 2 longer"; empty on level ground. The focused marker's tag. */
export function liftWords(climb: number, shift: number): string {
  if (climb === 0 || shift === 0) return '';
  const up = climb > 0;
  return `${up ? '+' : MINUS}${String(Math.abs(climb))} ${up ? 'uphill' : 'downhill'} · ${liftTag(shift)}`;
}

/** "Uphill all round · 1 shorter": what the tray says when every hit on offer climbs the same way. */
export function liftLine(climb: number, shift: number): string {
  const words = liftWords(climb, shift);
  return words === '' ? '' : `${climb > 0 ? 'Uphill' : 'Downhill'} all round · ${liftTag(shift)}`;
}

/** A climb and a shift every hit on offer shares. A climb of 0 is level ground: there is nothing to show. */
export interface SharedLift {
  climb: number;
  shift: number;
}

/**
 * The climb and shift every hit in `moves` shares, or null when they differ — which is the whole choice the screens
 * make: one line in the tray when they share it, a tag on each moved marker when they do not. An empty set shares
 * nothing (there is no hit to talk about).
 */
export function sharedLift(from: P, moves: readonly Move[]): SharedLift | null {
  const first = moves[0];
  if (first === undefined) return null;
  const lift: SharedLift = { climb: first.climb ?? 0, shift: shiftOf(from, first) };
  for (const m of moves) {
    if ((m.climb ?? 0) !== lift.climb || shiftOf(from, m) !== lift.shift) return null;
  }
  return lift;
}
