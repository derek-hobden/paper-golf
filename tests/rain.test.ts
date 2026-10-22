import { describe, expect, it } from 'vitest';
import { diceDistance, isLandable, movesForRoll, onGreen, puttMoves, rainDistance, resolveShot } from '../src/engine/rules';
import { mulberry32 } from '../src/engine/rng';
import { rainForHole, rainLabel, rollRain } from '../src/engine/rain';
import { CALM, type Cell, type Dir, type P, type Wind } from '../src/engine/types';
import { windForHole } from '../src/engine/wind';
import {
  HOLES_IN_ROUND,
  availableMoves,
  currentBall,
  currentHole,
  holeRain,
  holeWind,
  loadState,
  newGame,
  nextHole,
  roll,
  shoot,
  skipToHole,
  type GameState,
} from '../src/game/game';
import { at, defined, holeOutWithPutt, testHole } from './helpers';

// Rain is the hole's other weather, rolled next to the wind from its own round seed (`rainForHole`): about one hole in
// five is rainy, and a rainy hole can be calm or windy. On a rainy hole the ground is wet, so slopes never roll the
// ball (it stops where it lands), and the air is heavy, so the longest hit available is one space shorter than normal
// (never below 1). Sand and water play exactly as they do in the dry.

/** A rain seed whose Meadow Links hole 1 is rainy, so dropping the field from a save really does change the hole. */
const RAINY_FIRST_HOLE_SEED = 2;

const N: Dir = 0;
const E: Dir = 2;
const S: Dir = 4;
const W: Dir = 6;
const slope = (dir: Dir): Cell => ({ t: 'rough', slope: dir });
const wind = (strength: Wind['strength'], dir: Dir): Wind => ({ strength, dir });

describe('rain roll', () => {
  it('rains on about one hole in five', () => {
    const rng = mulberry32(2468);
    const n = 40000;
    let rainy = 0;
    for (let i = 0; i < n; i++) if (rollRain(rng)) rainy++;
    expect(Math.abs(rainy / n - 0.2)).toBeLessThan(0.01);
  });

  it('is deterministic per round seed, course and hole, and varies across them', () => {
    expect(rainForHole(7, 2, 5)).toBe(rainForHole(7, 2, 5));
    const rainy = (seed: number) => Array.from({ length: HOLES_IN_ROUND }, (_, h) => rainForHole(seed, 0, h)).filter(Boolean).length;
    // Over many rounds roughly a fifth of the 18 holes are rainy, and the pattern differs from round to round.
    const rounds = Array.from({ length: 60 }, (_, seed) => rainy(seed));
    const mean = rounds.reduce((a, b) => a + b, 0) / rounds.length;
    expect(mean).toBeGreaterThan(18 * 0.1);
    expect(mean).toBeLessThan(18 * 0.3);
    expect(new Set(rounds).size).toBeGreaterThan(3);
    // Within one round the courses get their own weather: hole 12 is rainy on some and dry on others.
    const courses = new Set<boolean>();
    for (let seed = 0; seed < 8; seed++) for (let c = 0; c < 5; c++) courses.add(rainForHole(seed, c, 11));
    expect([...courses].sort()).toEqual([false, true]);
  });

  it('is independent of the wind: calm and windy holes are both rainy at the default seed', () => {
    const pairs = new Set<string>();
    for (let seed = 0; seed < 8; seed++)
      for (let c = 0; c < 5; c++)
        for (let h = 0; h < HOLES_IN_ROUND; h++)
          pairs.add(`${String(rainForHole(seed, c, h))}:${String(windForHole(seed, c, h).strength > 0)}`);
    expect([...pairs].sort()).toEqual(['false:false', 'false:true', 'true:false', 'true:true']);
  });

  it('reads "Rain" in the HUD, and nothing when dry', () => {
    expect(rainLabel(true)).toBe('Rain');
    expect(rainLabel(false)).toBe('');
  });
});

describe('wet ground: slopes do not roll the ball in the rain', () => {
  it('leaves a hit where it lands instead of rolling it one dot downhill', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '4,4': slope(E) });
    const from = { x: 1, y: 4 };
    expect(resolveShot(h, from, E, 3)).toMatchObject({ end: { x: 5, y: 4 }, rolled: true });
    expect(resolveShot(h, from, E, 3, CALM, true)).toMatchObject({ end: { x: 4, y: 4 }, rolled: false });
    expect(resolveShot(h, from, E, 3, CALM, true).rolls).toBeUndefined();
  });

  it('stops a whole chain of slopes', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '4,4': slope(E), '5,4': slope(S), '5,5': slope(S) });
    expect(resolveShot(h, { x: 1, y: 4 }, E, 3).end).toEqual({ x: 5, y: 6 });
    expect(resolveShot(h, { x: 1, y: 4 }, E, 3, CALM, true).end).toEqual({ x: 4, y: 4 });
  });

  it('never rolls a ball into the cup off a slope', () => {
    const h = testHole(9, 9, { x: 5, y: 4 }, { '4,4': slope(E) });
    expect(resolveShot(h, { x: 1, y: 4 }, E, 3)).toMatchObject({ holed: true, rolled: true });
    expect(resolveShot(h, { x: 1, y: 4 }, E, 3, CALM, true)).toMatchObject({ holed: false, end: { x: 4, y: 4 } });
  });

  it('leaves a ball the wind pushed onto a slope where the wind left it', () => {
    const h = testHole(9, 9, { x: 8, y: 8 }, { '4,2': slope(E) });
    const from = { x: 1, y: 4 };
    expect(resolveShot(h, from, E, 3, wind(2, N))).toMatchObject({ end: { x: 5, y: 2 }, blown: true, rolled: true });
    expect(resolveShot(h, from, E, 3, wind(2, N), true)).toMatchObject({ end: { x: 4, y: 2 }, blown: true, rolled: false });
  });

  it('never rolls a putt on, on the green or off it', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '4,4': slope(E), '2,4': slope(W) });
    const from = { x: 3, y: 4 };
    const end = (rain: boolean, dir: Dir) => puttMoves(h, from, 1, rain).find((m) => m.dir === dir)?.result;
    expect(end(false, E)).toMatchObject({ end: { x: 5, y: 4 }, rolled: true });
    expect(end(true, E)).toMatchObject({ end: { x: 4, y: 4 }, rolled: false });
    expect(end(false, W)).toMatchObject({ end: { x: 1, y: 4 }, rolled: true });
    expect(end(true, W)).toMatchObject({ end: { x: 2, y: 4 }, rolled: false });
  });
});

describe('heavy air: the longest hit is one space shorter in the rain', () => {
  it('takes a space off every hit distance above one, and never goes below one', () => {
    expect(rainDistance(0)).toBe(0);
    expect(rainDistance(1)).toBe(1);
    expect(rainDistance(2)).toBe(1);
    expect(rainDistance(7)).toBe(6);
  });

  it('shortens the dice distance by one from every lie, sand and the fairway included', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '1,1': { t: 'fairway' }, '2,2': { t: 'sand' } });
    const rough = { x: 0, y: 0 };
    const fairway = { x: 1, y: 1 };
    const sand = { x: 2, y: 2 };
    expect([diceDistance(h, rough, 4), diceDistance(h, rough, 4, true)]).toEqual([4, 3]);
    expect([diceDistance(h, fairway, 4), diceDistance(h, fairway, 4, true)]).toEqual([5, 4]);
    expect([diceDistance(h, sand, 4), diceDistance(h, sand, 4, true)]).toEqual([3, 2]);
    // Never below 1, and a lie that offers no hit at all still offers none.
    expect([diceDistance(h, rough, 1), diceDistance(h, rough, 1, true)]).toEqual([1, 1]);
    expect([diceDistance(h, sand, 1), diceDistance(h, sand, 1, true)]).toEqual([0, 0]);
  });

  it('offers the hits of that shorter distance, and only the putt when the dry hit was two', () => {
    const h = testHole(9, 9, { x: 8, y: 0 });
    const from = { x: 4, y: 4 };
    const hits = (roll: number, rain: boolean) => movesForRoll(h, from, roll, CALM, rain).filter((m) => m.kind === 'hit');
    expect(new Set(hits(4, false).map((m) => m.dist))).toEqual(new Set([4]));
    expect(new Set(hits(4, true).map((m) => m.dist))).toEqual(new Set([3]));
    expect(hits(4, true).length).toBe(hits(4, false).length);
    expect(hits(2, false).length).toBeGreaterThan(0);
    expect(hits(2, true)).toEqual([]);
    // The 1-dot putt is always there, rain or not.
    expect(movesForRoll(h, from, 2, CALM, true).every((m) => m.kind === 'putt')).toBe(true);
  });

  it('leaves the green alone: a rolled 2 or 3 still putts that far in the rain', () => {
    const h = testHole(9, 9, { x: 4, y: 4 });
    const from = { x: 6, y: 4 };
    for (const roll of [1, 2, 3, 4, 5, 6])
      expect(movesForRoll(h, from, roll, CALM, true).map((m) => ({ dir: m.dir, dist: m.dist, kind: m.kind }))).toEqual(
        movesForRoll(h, from, roll).map((m) => ({ dir: m.dir, dist: m.dist, kind: m.kind })),
      );
  });
});

/**
 * A spot and die on the current hole where the dry hit is rolled on by a slope and the rain's shorter hit is still a
 * hit (two spaces or more), so both effects show on one shot.
 */
function slopeRollSpot(g: GameState): { pos: P; die: number } {
  const hole = currentHole(g);
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const pos = { x, y };
      if (!isLandable(hole, pos) || onGreen(hole, pos)) continue;
      for (let die = 1; die <= 6; die++) {
        if (diceDistance(hole, pos, die, true) < 2) continue;
        if (movesForRoll(hole, pos, die, holeWind(g)).some((m) => m.kind === 'hit' && m.result.rolled && !m.result.holed)) return { pos, die };
      }
    }
  throw new Error('no hole where a hit rolls on down a slope');
}

describe('rain in the game', () => {
  it('rolls one rain per hole at its start, the same for every player, reproducible from the round seed', () => {
    const a = newGame(1, ['A', 'B'], 99, 77);
    const b = newGame(1, ['A', 'B'], 99, 77);
    const seen = new Set<boolean>();
    for (let h = 0; h < HOLES_IN_ROUND; h++) {
      expect(holeRain(a)).toBe(rainForHole(77, 1, h));
      expect(holeRain(b)).toBe(holeRain(a));
      seen.add(holeRain(a));
      const before = holeRain(a);
      while (!a.holeDone) holeOutWithPutt(a);
      expect(holeRain(a)).toBe(before);
      if (h + 1 < HOLES_IN_ROUND) {
        nextHole(a);
        skipToHole(b, h + 1);
      }
    }
    // That round has both kinds of weather in it, so the round seed really is deciding each hole.
    expect([...seen].sort()).toEqual([false, true]);
  });

  it('plays a rainy hole wet and heavy: shorter hits, and the ball left where it lands', () => {
    const g = newGame(0, ['A'], 0, 0);
    const { pos, die } = slopeRollSpot(g);
    currentBall(g).pos = { ...pos };
    currentBall(g).strokes = 1;
    g.rain = true;
    roll(g, die);
    const hole = currentHole(g);
    expect(availableMoves(g)).toEqual(movesForRoll(hole, pos, die, holeWind(g), true));
    const hits = availableMoves(g).filter((m) => m.kind === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    // One space shorter than the dry hit, and no slope rolls any of them on (dry, at least one does).
    expect(hits.every((m) => m.dist === diceDistance(hole, pos, die) - 1)).toBe(true);
    expect(movesForRoll(hole, pos, die, holeWind(g)).some((m) => m.result.rolled)).toBe(true);
    expect(hits.some((m) => m.result.rolled)).toBe(false);
    const m = at(hits, 0);
    const { record } = shoot(g, m.dir, m.dist);
    expect(record).toMatchObject({ rolled: false, end: m.result.end });
    expect(record.rolls).toBeUndefined();
    expect(currentBall(g).pos).toEqual(m.result.end);
  });

  it('loads a round saved before rain as a dry one, this hole and the next', () => {
    const g = newGame(0, ['A'], 5, RAINY_FIRST_HOLE_SEED);
    expect(holeRain(g)).toBe(true);
    const old: Partial<GameState> = { ...g };
    delete old.rain;
    delete old.rainSeed;
    const loaded = defined(loadState(JSON.parse(JSON.stringify(old))), 'loaded');
    expect(holeRain(loaded)).toBe(false);
    while (!loaded.holeDone) holeOutWithPutt(loaded);
    nextHole(loaded);
    expect(holeRain(loaded)).toBe(false);
  });
});

describe('sand and water play as they do in the dry', () => {
  it('keeps the sand penalty, and still refuses a hit that comes down in water or trees', () => {
    const h = testHole(9, 9, { x: 8, y: 0 }, { '2,2': { t: 'sand' }, '4,4': { t: 'water' }, '6,4': { t: 'tree' } });
    expect(resolveShot(h, { x: 1, y: 4 }, E, 3, CALM, true)).toMatchObject({ legal: false, reason: 'water' });
    expect(resolveShot(h, { x: 3, y: 4 }, E, 3, CALM, true)).toMatchObject({ legal: false, reason: 'trees' });
    // A hit out of the sand still carries one space less than the roll (then one less again for the rain).
    expect(movesForRoll(h, { x: 2, y: 2 }, 5, CALM, true).filter((m) => m.kind === 'hit').every((m) => m.dist === 3)).toBe(true);
  });
});
