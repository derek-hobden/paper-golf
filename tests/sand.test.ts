import { describe, expect, it } from 'vitest';
import { holeFromAscii } from '../src/engine/ascii';
import { generateProperHole } from '../src/engine/generator';
import {
  GREEN_RADIUS,
  cellAt,
  diceDistance,
  dotsApart,
  elevatedDistance,
  isGrass,
  isLandable,
  isTapIn,
  movesForRoll,
  onGreen,
} from '../src/engine/rules';
import { diceExpectation, diceExpectedFromTee } from '../src/engine/solver';
import { DIRS, type P } from '../src/engine/types';
import {
  autoPutt,
  autoPuttMove,
  availableMoves,
  currentBall,
  currentHole,
  holeRain,
  holeWind,
  loadState,
  newBuiltRound,
  newGame,
  roll,
  shoot,
} from '../src/game/game';
import { at, defined, greensideBunkers } from './helpers';
import { playHoleTypically, seededD6, typicalPick } from './sim';
import { EVERY_HOLE } from './sweep';

// Landing in a sand bunker plays as sand everywhere, inside the green's ring as much as out of it: the lie is sand,
// so the hint reads sand and the next shot is a sand shot (the roll less one), never a green putt. The bug (Derek,
// 24 Oct 2026, "I dont think landing in sand has any effect? The hint in corner says its in the green and it seems
// to putt?"): `onGreen` counted every dot within 2 of the cup, whatever the terrain, and the generator puts its
// first sand trap round the green, so 282 sand dots over the 90 holes putted like green and lost the −1.

const S = 4;

/** A bunker two dots north of the cup, with grass beside it at the same distance. */
const BUNKER = holeFromAscii([
  '..s..', // (2,0): sand, 2 dots from the cup
  '.....',
  '..@..', // the cup
  '.....',
  '....o', // the tee
]);
const BUNKER_DOT: P = { x: 2, y: 0 };
const GRASS_DOT: P = { x: 0, y: 2 };

describe('a sand bunker', () => {
  it('is never on the green, however close to the cup it lies', () => {
    expect(dotsApart(BUNKER_DOT, BUNKER.cup)).toBe(GREEN_RADIUS);
    expect(onGreen(BUNKER, BUNKER_DOT)).toBe(false);
    expect(isGrass(BUNKER, BUNKER_DOT)).toBe(false);
    // The grass beside it, the same two dots out, is green as it always was.
    expect(dotsApart(GRASS_DOT, BUNKER.cup)).toBe(GREEN_RADIUS);
    expect(onGreen(BUNKER, GRASS_DOT)).toBe(true);
    expect(isGrass(BUNKER, GRASS_DOT)).toBe(true);
  });

  it('keeps the −1 on the hit inside the green ring', () => {
    for (let r = 1; r <= 6; r++) expect(diceDistance(BUNKER, BUNKER_DOT, r)).toBe(Math.max(0, r - 1));
  });

  it('offers a sand shot and the 1-dot putt, never a 2- or 3-dot putt', () => {
    const kinds = (roll: number) => movesForRoll(BUNKER, BUNKER_DOT, roll).map((m) => `${m.kind} ${String(m.dist)}`);
    // A roll of 2 or 3 earned a 2- or 3-dot putt while the bunker counted as green; now the roll hits out, less one.
    expect(new Set(kinds(2))).toEqual(new Set(['putt 1']));
    expect(new Set(kinds(3))).toEqual(new Set(['putt 1', 'hit 2']));
    expect(new Set(kinds(4))).toEqual(new Set(['putt 1', 'hit 3']));
    for (let r = 1; r <= 6; r++) expect(new Set(kinds(r).filter((k) => k.startsWith('putt')))).toEqual(new Set(['putt 1']));
    // Straight at the cup: the sand shot drops on a 3 (2 dots) and on a 4 (3 dots, the overshoot), not on a 2.
    const holes = (roll: number) => movesForRoll(BUNKER, BUNKER_DOT, roll).some((m) => m.dir === S && m.result.holed);
    expect([1, 2, 3, 4, 5, 6].map(holes)).toEqual([false, false, true, true, false, false]);
    // From the grass at the same distance the green putt still holes on a 2 or a 3.
    const grassHoles = (roll: number) => movesForRoll(BUNKER, GRASS_DOT, roll).some((m) => m.result.holed);
    expect([1, 2, 3, 4, 5, 6].map(grassHoles)).toEqual([false, true, true, false, false, false]);
  });

  it('plays as sand on the sand/green border: each dot reads its own lie', () => {
    // Half the ring is sand, half grass, all of it two dots from the cup or less.
    const edge = holeFromAscii(['sss..', 'sss..', 'ss@..', '.....', '....o']);
    const sandy: P = { x: 1, y: 1 };
    const grassy: P = { x: 3, y: 1 };
    expect([cellAt(edge, sandy).t, cellAt(edge, grassy).t]).toEqual(['sand', 'rough']);
    expect([onGreen(edge, sandy), onGreen(edge, grassy)]).toEqual([false, true]);
    expect(movesForRoll(edge, sandy, 3).some((m) => m.kind === 'hit' && m.dist === 2)).toBe(true);
    expect(movesForRoll(edge, grassy, 3).every((m) => m.kind === 'putt')).toBe(true);
  });

  it('still taps in from next to the cup, and reads as sand until it does', () => {
    const next = holeFromAscii(['.....', '..s..', '..@..', '.....', '....o']);
    const dot: P = { x: 2, y: 1 };
    expect(dotsApart(dot, next.cup)).toBe(1);
    expect(isTapIn(next, dot)).toBe(true);
    // Not green, so the lie still reads sand and a longer roll would hit out less one.
    expect(onGreen(next, dot)).toBe(false);
    expect(movesForRoll(next, dot, 4).some((m) => m.kind === 'hit' && m.dist === 3)).toBe(true);
    // The 1-dot putt is allowed from any lie and always holes from one dot out, so the tap-in is unchanged.
    const g = newBuiltRound(next, ['A']);
    currentBall(g).pos = { ...dot };
    expect(autoPuttMove(g)?.result.holed).toBe(true);
    autoPutt(g);
    expect([currentBall(g).holed, currentBall(g).strokes]).toEqual([true, 1]);
  });
});

describe('the game and a greenside bunker', () => {
  /** A solo round on Meadow Links hole 1, the ball resting in the hole's greenside bunker. */
  const inBunker = () => {
    const g = newGame(0, ['Player 1']);
    const bunker = defined(greensideBunkers(currentHole(g))[0], 'a greenside bunker on hole 1');
    currentBall(g).pos = { ...bunker };
    currentBall(g).strokes = 2;
    return { g, bunker };
  };

  it('offers a sand shot from the bunker, not a green putt', () => {
    const { g, bunker } = inBunker();
    const hole = currentHole(g);
    expect(cellAt(hole, bunker).t).toBe('sand');
    expect(onGreen(hole, bunker)).toBe(false);
    expect(autoPuttMove(g)).toBeNull();
    roll(g, 3);
    const moves = availableMoves(g);
    expect(moves.filter((m) => m.kind === 'putt').every((m) => m.dist === 1)).toBe(true);
    expect(moves.some((m) => m.kind === 'hit' && m.dist === diceDistance(hole, bunker, 3))).toBe(true);
  });

  it('plays as sand when a round saved mid-hole in the bunker is restored', () => {
    const { g, bunker } = inBunker();
    const saved = defined(loadState(JSON.parse(JSON.stringify(g)) as unknown), 'the restored round');
    expect(currentBall(saved).pos).toEqual(bunker);
    const hole = currentHole(saved);
    expect(onGreen(hole, currentBall(saved).pos)).toBe(false);
    roll(saved, 2);
    // A roll of 2 used to earn a 2-dot putt here; from sand it is a putt of 1 (the hit would be a single dot).
    expect(availableMoves(saved).map((m) => `${m.kind} ${String(m.dist)}`).every((k) => k === 'putt 1')).toBe(true);
  });

  it('lets the typical player (the AI the sims play with) hit out of the bunker as sand', () => {
    const { g, bunker } = inBunker();
    const hole = currentHole(g);
    // What the AI can pick from the bunker, roll by roll: the 1-dot putt, or a hit of the roll less one. A drop from
    // here is a sand shot, never the long green putt a 2 or a 3 used to earn it.
    for (let r = 1; r <= 6; r++) {
      const pick = typicalPick(hole, movesForRoll(hole, bunker, r, holeWind(g), holeRain(g)));
      expect(pick.dist).toBe(pick.kind === 'putt' ? 1 : Math.max(0, r - 1));
      expect(pick.result.holed && pick.kind === 'putt').toBe(false);
    }
    // A 2 is the roll that used to hole out of the bunker with a 2-dot putt: from sand it offers the 1-dot putt only.
    expect(movesForRoll(hole, bunker, 2, holeWind(g), holeRain(g)).some((m) => m.result.holed)).toBe(false);
    // And it plays the hole out from there through the real game state machine, as `proper.sim.test.ts` does.
    playHoleTypically(g, seededD6(7));
    expect(currentBall(g).holed).toBe(true);
    expect(currentBall(g).strokes).toBeGreaterThan(2);
  });

  it('holes out of the bunker, so the lie never strands a player', () => {
    const { g } = inBunker();
    for (let turn = 0; turn < 8 && !currentBall(g).holed; turn++) {
      if (autoPuttMove(g)) {
        autoPutt(g);
        continue;
      }
      roll(g, 1);
      const hole = currentHole(g);
      const before = dotsApart(currentBall(g).pos, hole.cup);
      const moves = availableMoves(g);
      const m = moves.find((o) => dotsApart(o.result.end, hole.cup) < before) ?? defined(moves[0], 'a move out of the bunker');
      shoot(g, m.dir, m.dist);
    }
    expect(currentBall(g).holed).toBe(true);
  });
});

describe('the solver and a greenside bunker', () => {
  it('values a bunker as a lie you hit out of, not a green you putt on', () => {
    // Water between the bunker and the cup: a putt may not roll through it, but a hit flies over. While the bunker
    // counted as green its only move was a 1-dot putt sideways; as sand the roll hits out, over the water.
    const rows = ['..s..', '..w..', '..@..', '.....', '....o'];
    const sandy = holeFromAscii(rows);
    const grassy = holeFromAscii(rows.map((r) => r.replace('s', '.')));
    const dot: P = { x: 2, y: 0 };
    const k = dot.y * sandy.w + dot.x;
    const sandValue = at(diceExpectation(sandy), k);
    const grassValue = at(diceExpectation(grassy), k);
    expect(Number.isFinite(sandValue)).toBe(true);
    expect(sandValue).toBeLessThan(grassValue);
    // The sand shot that gets there: 2 dots on a roll of 3, over the water.
    expect(movesForRoll(sandy, dot, 3).some((m) => m.kind === 'hit' && m.dist === 2 && m.result.holed)).toBe(true);
    expect(movesForRoll(grassy, dot, 3).some((m) => m.result.holed)).toBe(false);
  });

  it('still solves a hole whose green is ringed with sand', () => {
    const ringed = holeFromAscii(['sssss', 's...s', 's.@.s', 's...s', 'ssoss']);
    expect(Number.isFinite(diceExpectedFromTee(ringed))).toBe(true);
  });
});

describe('every Proper golf hole', () => {
  // One case per hole (all 90): generating a course inside one test runs it against the 30s timeout (#8, #9).
  it.each(EVERY_HOLE)('plays its sand as sand on course $c hole $n', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    for (let y = 0; y < hole.h; y++)
      for (let x = 0; x < hole.w; x++) {
        const p = { x, y };
        if (cellAt(hole, p).t !== 'sand') continue;
        expect(onGreen(hole, p), `sand on the green at ${String(x)},${String(y)}`).toBe(false);
        if (!isLandable(hole, p) || dotsApart(p, hole.cup) <= 1) continue;
        for (let r = 1; r <= 6; r++) {
          const moves = movesForRoll(hole, p, r);
          expect(moves.filter((m) => m.kind === 'putt').every((m) => m.dist === 1)).toBe(true);
          // Sand's −1 is all the lie does: it sets the distance the hit starts from, and a change of height then
          // moves that by its own climb and nothing else (`hitMoves`).
          const base = diceDistance(hole, p, r);
          expect(base).toBe(Math.max(0, r - 1));
          expect(moves.filter((m) => m.kind === 'hit').every((m) => m.dist === elevatedDistance(base, m.climb ?? 0))).toBe(true);
        }
      }
  });

  it.each(EVERY_HOLE)('keeps every cup neighbour one stroke on course $c hole $n, sand included', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    const v = diceExpectation(hole);
    for (const d of DIRS) {
      const p = { x: hole.cup.x + d.x, y: hole.cup.y + d.y };
      if (isLandable(hole, p)) expect(at(v, p.y * hole.w + p.x)).toBeCloseTo(1, 9);
    }
  });
});
