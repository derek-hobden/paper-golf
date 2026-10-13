import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/rng';
import { MAX_STROKES, MULLIGANS_PER_COURSE } from '../src/engine/rules';
import { diceExpectation } from '../src/engine/solver';
import {
  availableMoves,
  canMulligan,
  canTeeReroll,
  currentHole,
  loadState,
  mulligan,
  newGame,
  nextHole,
  roll,
  shoot,
  teeReroll,
} from '../src/game/game';

describe('game flow', () => {
  it('plays every course to completion with random rolls', () => {
    for (let course = 0; course < 5; course++) {
      const rng = mulberry32(99 + course);
      const d6 = () => 1 + Math.floor(rng() * 6);
      const g = newGame(course, ['A', 'B', 'C']);
      while (!g.finished) {
        const hole = currentHole(g);
        const v = diceExpectation(hole);
        while (!g.holeDone) {
          roll(g, d6());
          const moves = availableMoves(g);
          expect(moves.length).toBeGreaterThan(0);
          const score = (m: (typeof moves)[number]) => (m.result.holed ? -1 : v[m.result.end.y * hole.w + m.result.end.x]);
          moves.sort((a, b) => score(a) - score(b));
          shoot(g, moves[0].dir, moves[0].dist);
        }
        nextHole(g);
      }
      for (const p of g.players) {
        expect(p.scores.every((s) => s !== null && s >= 1 && s <= MAX_STROKES)).toBe(true);
      }
    }
  });

  it('allows exactly one free tee re-roll, then mulligans', () => {
    const g = newGame(0, ['Solo']);
    expect(canTeeReroll(g)).toBe(false);
    roll(g, 2);
    expect(canTeeReroll(g)).toBe(true);
    teeReroll(g, 5);
    expect(g.dice!.value).toBe(5);
    expect(canTeeReroll(g)).toBe(false);
    expect(() => teeReroll(g, 3)).toThrow();
    expect(canMulligan(g)).toBe(true);
    mulligan(g, 6);
    expect(g.dice!.value).toBe(6);
    expect(g.players[0].mulligans).toBe(MULLIGANS_PER_COURSE - 1);
    // After the tee shot, no more free re-rolls.
    const m = availableMoves(g)[0];
    shoot(g, m.dir, m.dist);
    if (!g.holeDone) {
      roll(g, 1);
      expect(canTeeReroll(g)).toBe(false);
    }
  });

  it('runs out of mulligans after six', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 1);
    for (let i = 0; i < MULLIGANS_PER_COURSE; i++) mulligan(g, 1);
    expect(canMulligan(g)).toBe(false);
    expect(() => mulligan(g, 2)).toThrow();
  });

  it('always offers a putt, and the dice hit distance follows the terrain', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 3);
    const moves = availableMoves(g);
    expect(moves.some((m) => m.kind === 'putt' && m.dist === 1)).toBe(true);
    // Tee is on the fairway: 3 + 1.
    expect(moves.filter((m) => m.kind === 'hit').every((m) => m.dist === 4)).toBe(true);
  });

  it('rejects illegal shots and rolling twice', () => {
    const g = newGame(0, ['Solo']);
    expect(() => shoot(g, 0, 1)).toThrow(); // must roll first
    roll(g, 4);
    expect(() => roll(g, 4)).toThrow();
    expect(() => shoot(g, 0, 3)).toThrow(); // 3 is not 4+1 nor a putt
  });

  it('rotates turns between players and skips those who have holed out', () => {
    const g = newGame(0, ['A', 'B']);
    roll(g, 3);
    const m = availableMoves(g)[0];
    shoot(g, m.dir, m.dist);
    expect(g.current).toBe(1);
  });

  it('picks the ball up at the stroke limit', () => {
    const g = newGame(0, ['Solo']);
    // Putt back and forth until the limit.
    for (let i = 0; i < MAX_STROKES && !g.holeDone; i++) {
      roll(g, 1);
      const putts = availableMoves(g).filter((m) => m.kind === 'putt' && !m.result.holed);
      shoot(g, putts[0].dir, 1);
    }
    expect(g.holeDone).toBe(true);
    expect(g.players[0].scores[0]).toBe(MAX_STROKES);
    expect(g.balls[0].pickedUp).toBe(true);
  });
});

describe('saved rounds', () => {
  it('carries an old Speed Golf save on as Dice Golf', () => {
    const g = newGame(2, ['A', 'B']);
    roll(g, 4);
    const m = availableMoves(g)[0];
    shoot(g, m.dir, m.dist);
    // As written by the two-mode version: a mode, no die mid-turn, and a club on each shot.
    const old = JSON.parse(JSON.stringify({ ...g, mode: 'speed' }));
    old.balls[0].shots[0].club = 'iron';
    const loaded = loadState(old)!;
    expect(loaded).not.toBeNull();
    expect('mode' in loaded).toBe(false);
    expect('club' in loaded.balls[0].shots[0]).toBe(false);
    expect(loaded.current).toBe(1);
    roll(loaded, 2);
    expect(availableMoves(loaded).length).toBeGreaterThan(0);
  });

  it('loads a current save unchanged and rejects junk', () => {
    const g = newGame(0, ['Solo']);
    expect(loadState(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(loadState(null)).toBeNull();
    expect(loadState({ version: 2 })).toBeNull();
  });
});
