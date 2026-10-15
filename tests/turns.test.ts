import { describe, expect, it } from 'vitest';
import { dotsApart, isLandable, legalMoves, onGreen } from '../src/engine/rules';
import type { P } from '../src/engine/types';
import {
  availableMoves,
  currentBall,
  currentHole,
  loadState,
  mulligan,
  newGame,
  nextHole,
  nextToPlay,
  playerMarks,
  roll,
  shoot,
  skipToHole,
  teeOrder,
  teeReroll,
  turnReason,
  type GameState,
} from '../src/game/game';
import { at, defined, findMove, holeOutWithPutt, puttWithoutHoling } from './helpers';

/** Golf etiquette: honour on the tee (best score on the last hole first), then the ball furthest from the cup plays. */

/** End the current hole with these scores (one per player, in setup order), as if everyone had holed out. */
function finishHole(g: GameState, scores: number[]) {
  scores.forEach((s, i) => {
    at(g.players, i).scores[g.holeIndex] = s;
    Object.assign(at(g.balls, i), { holed: true, strokes: s, pos: { ...currentHole(g).cup } });
  });
  g.holeDone = true;
}

/** A landable spot off the green exactly `d` dots from the cup with a 1-dot putt that doesn't hole. */
function spotAt(g: GameState, d: number, not: P[] = []): P {
  const hole = currentHole(g);
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const p = { x, y };
      if (dotsApart(p, hole.cup) !== d || !isLandable(hole, p) || onGreen(hole, p)) continue;
      if (not.some((q) => q.x === x && q.y === y)) continue;
      if (legalMoves(hole, p, 1).some((m) => !m.result.holed)) return p;
    }
  throw new Error(`no spot ${String(d)} dots from the cup`);
}

/** Everyone has teed off: put each ball (setup order) on its spot with one stroke played. */
function placeBalls(g: GameState, spots: P[]) {
  spots.forEach((p, i) => {
    Object.assign(at(g.balls, i), { pos: { ...p }, strokes: 1 });
  });
}

/** The current player rolls a 1 and putts 1 dot, not holing. */
function putt1(g: GameState) {
  roll(g, 1);
  const m = findMove(availableMoves(g), (o) => o.kind === 'putt' && o.dist === 1 && !o.result.holed);
  shoot(g, m.dir, m.dist);
}

describe('honour on the tee', () => {
  it('tees off hole 1 in the order the players were set up', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    expect(teeOrder(g)).toEqual([0, 1, 2]);
    expect(g.current).toBe(0);
    expect(turnReason(g)).toBe('honour');
    puttWithoutHoling(g);
    expect(g.current).toBe(1);
    expect(turnReason(g)).toBe('tee');
    puttWithoutHoling(g);
    expect(g.current).toBe(2);
    expect(turnReason(g)).toBe('tee');
  });

  it('gives the honour to the winner of the last hole, then the next lowest', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    finishHole(g, [5, 3, 4]);
    nextHole(g);
    expect(teeOrder(g)).toEqual([1, 2, 0]);
    expect(g.current).toBe(1);
    expect(turnReason(g)).toBe('honour');
    puttWithoutHoling(g); // B
    expect(g.current).toBe(2);
    puttWithoutHoling(g); // C
    expect(g.current).toBe(0);
    expect(turnReason(g)).toBe('tee');
  });

  it('keeps tied players in their order from the previous tee, not the setup order', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    finishHole(g, [4, 4, 3]);
    nextHole(g);
    expect(teeOrder(g)).toEqual([2, 0, 1]); // C won; A and B tied, A teed before B
    finishHole(g, [5, 3, 3]);
    nextHole(g);
    expect(teeOrder(g)).toEqual([2, 1, 0]); // B and C tied: C teed before B on hole 2
    expect(g.current).toBe(2);
  });

  it('a deep link that skips holes tees off in setup order', () => {
    const g = newGame(0, ['A', 'B', 'C', 'D']);
    skipToHole(g, 6);
    expect(teeOrder(g)).toEqual([0, 1, 2, 3]);
    expect(g.current).toBe(0);
  });
});

describe('away plays next', () => {
  it('after the tee shots, the ball furthest from the cup plays', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    const near = spotAt(g, 4);
    const far = spotAt(g, 7);
    const mid = spotAt(g, 5);
    placeBalls(g, [near, far, mid]);
    expect(nextToPlay(g)).toBe(1);
  });

  it('measures distance in dots (diagonals count 1), like a shot', () => {
    const g = newGame(0, ['A', 'B']);
    const hole = currentHole(g);
    const a = spotAt(g, 5);
    const b = spotAt(g, 6);
    placeBalls(g, [a, b]);
    expect(dotsApart(at(g.balls, 1).pos, hole.cup)).toBe(6);
    expect(nextToPlay(g)).toBe(1);
  });

  it('breaks a tie by this hole’s tee order', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    finishHole(g, [4, 4, 3]);
    nextHole(g); // tee order C, A, B
    const p = spotAt(g, 6);
    const q = spotAt(g, 6, [p]);
    placeBalls(g, [spotAt(g, 4), p, q]); // B and C tie
    expect(nextToPlay(g)).toBe(2);
    placeBalls(g, [p, q, spotAt(g, 4)]); // A and B tie
    expect(nextToPlay(g)).toBe(0);
  });

  it('lets the same player play twice in a row while still furthest away', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    puttWithoutHoling(g); // A
    puttWithoutHoling(g); // B
    // C's tee shot is still to come; A and B sit close, C's ball stays well back after its shot.
    placeBalls(g, [spotAt(g, 3), spotAt(g, 4)]);
    currentBall(g).pos = { ...spotAt(g, 10) };
    putt1(g); // C, still ≥ 9 away
    expect(g.current).toBe(2);
    expect(turnReason(g)).toBe('away');
    putt1(g); // C again, ≥ 8 away
    expect(g.current).toBe(2);
    expect(turnReason(g)).toBe('away');
  });

  it('skips players who have holed out or picked up, and ends the hole when nobody is left', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    placeBalls(g, [spotAt(g, 4), spotAt(g, 9), spotAt(g, 5)]);
    Object.assign(at(g.balls, 1), { pickedUp: true }); // furthest, but picked up
    expect(nextToPlay(g)).toBe(2);
    g.current = 2;
    holeOutWithPutt(g); // C
    expect(g.current).toBe(0);
    holeOutWithPutt(g); // A
    expect(g.holeDone).toBe(true);
    expect(nextToPlay(g)).toBeNull();
  });

  it('skips a player who holed out from the tee', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    holeOutWithPutt(g); // A holes with the first shot
    expect(g.current).toBe(1);
    puttWithoutHoling(g); // B
    expect(g.current).toBe(2);
    puttWithoutHoling(g); // C
    expect([1, 2]).toContain(g.current);
  });

  it('re-rolls and mulligans change the die, never whose turn it is', () => {
    const g = newGame(0, ['A', 'B']);
    puttWithoutHoling(g); // A
    roll(g, 2);
    teeReroll(g, 3);
    expect(g.current).toBe(1);
    mulligan(g, 4);
    expect(g.current).toBe(1);
  });
});

describe('solo play', () => {
  it('always plays the one ball and gives no reason', () => {
    const g = newGame(0, ['Solo']);
    expect(turnReason(g)).toBeNull();
    puttWithoutHoling(g);
    expect(g.current).toBe(0);
    expect(turnReason(g)).toBeNull();
  });
});

describe('saved rounds', () => {
  it('a round saved under round-robin turns continues with the player who is away', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    placeBalls(g, [spotAt(g, 4), spotAt(g, 8), spotAt(g, 5)]);
    g.current = 0; // round-robin's pick
    const loaded = defined(loadState(structuredClone(g)), 'loaded');
    expect(loaded.current).toBe(1);
  });

  it('keeps the player whose die is already showing', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    placeBalls(g, [spotAt(g, 4), spotAt(g, 8), spotAt(g, 5)]);
    g.current = 0;
    g.dice = { value: 3, teeRerolled: false };
    expect(defined(loadState(structuredClone(g)), 'loaded').current).toBe(0);
  });

  it('derives the tee order on a later hole from the card', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    finishHole(g, [5, 3, 4]);
    nextHole(g);
    const loaded = defined(loadState(JSON.parse(JSON.stringify(g))), 'loaded');
    expect(teeOrder(loaded)).toEqual([1, 2, 0]);
    expect(loaded.current).toBe(1);
  });
});

describe('ball marks', () => {
  it('uses initials when they differ, else player numbers', () => {
    expect(playerMarks(['ann', 'Bob', 'Cy'])).toEqual(['A', 'B', 'C']);
    expect(playerMarks(['Player 1', 'Player 2', 'Player 3'])).toEqual(['1', '2', '3']);
    expect(playerMarks(['Ann', 'Al'])).toEqual(['1', '2']);
    expect(playerMarks(['Ann', '  '])).toEqual(['1', '2']);
  });
});
