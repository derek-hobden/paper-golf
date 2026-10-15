/**
 * A "typical player" for simulating rounds through the real game state machine (`src/game/game.ts`): no lookahead,
 * no solver. They aim at the cup: hole out when they can, otherwise take the shot that ends nearest the cup, a little
 * wary of the rough and more of the sand. The free tee re-roll is used on a 1 or 2; mulligans are never used.
 */
import { mulberry32 } from '../src/engine/rng';
import { cellAt, dotsApart } from '../src/engine/rules';
import type { Hole, P } from '../src/engine/types';
import {
  autoPutt,
  autoPuttMove,
  availableMoves,
  canTeeReroll,
  currentHole,
  roll,
  shoot,
  teeReroll,
  type GameState,
  type MoveOption,
} from '../src/game/game';
import { at } from './helpers';

const LIE_COST = { fairway: 0, rough: 0.35, sand: 0.8, water: 0, tree: 0 } as const;

/** How the typical player rates a resting spot: dots to the cup plus a lie penalty (lower is better). */
export function spotCost(hole: Hole, p: P): number {
  return dotsApart(p, hole.cup) + LIE_COST[cellAt(hole, p).t];
}

export function typicalPick(hole: Hole, moves: MoveOption[]): MoveOption {
  const cost = (m: MoveOption) => (m.result.holed ? -1 : spotCost(hole, m.result.end));
  return at([...moves].sort((a, b) => cost(a) - cost(b)), 0);
}

/** Play the current hole out for every player with seeded dice. */
export function playHoleTypically(g: GameState, d6: () => number): void {
  while (!g.holeDone) {
    if (autoPuttMove(g)) {
      autoPutt(g);
      continue;
    }
    roll(g, d6());
    if (canTeeReroll(g) && (g.dice?.value ?? 6) <= 2) teeReroll(g, d6());
    const m = typicalPick(currentHole(g), availableMoves(g));
    shoot(g, m.dir, m.dist);
  }
}

export const seededD6 = (seed: number) => {
  const rng = mulberry32(seed);
  return () => 1 + Math.floor(rng() * 6);
};
