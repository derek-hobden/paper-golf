import { describe, expect, it } from 'vitest';
import { COURSES, PROPER_PARS } from '../src/engine/generator';
import { mulberry32 } from '../src/engine/rng';
import { MAX_STROKES, MULLIGANS_PER_ROUND, diceDistance, dotsApart, isLandable, movesForRoll } from '../src/engine/rules';
import { diceExpectation } from '../src/engine/solver';
import {
  HOLES_IN_ROUND,
  PLAYER_COLORS,
  ROUND_PAR,
  autoHole,
  autoHoleMove,
  autoPutt,
  autoPuttMove,
  availableMoves,
  canMulligan,
  canTeeReroll,
  currentBall,
  currentHole,
  formatToPar,
  holePar,
  isValidState,
  loadState,
  mulligan,
  newGame,
  nextHole,
  parseDeepLink,
  roll,
  scoreName,
  shoot,
  skipToHole,
  teeReroll,
  toPar,
  totalStrokes,
  type PlayerState,
} from '../src/game/game';
import { OLD_12_HOLE_SAVE, OLD_PRE_PROPER_SAVE } from './legacy-saves';
import { at, defined, findMove, holeOutWithPutt, overshootSetup, playTurn, puttWithoutHoling, spotNextToCup } from './helpers';
import { EVERY_COURSE } from './sweep';

describe('game flow', () => {
  // One case per course, each with its own seeded roll stream: playing all five in a single test ran it against
  // the 30s per-test timeout (#8).
  it.each(EVERY_COURSE)('plays course %i to completion with random rolls', (course) => {
    const rng = mulberry32(99 + course);
    const d6 = () => 1 + Math.floor(rng() * 6);
    const g = newGame(course, ['A', 'B', 'C']);
    while (!g.finished) {
      const hole = currentHole(g);
      const v = diceExpectation(hole);
      while (!g.holeDone) {
        playTurn(g, d6(), (moves) => {
          expect(moves.length).toBeGreaterThan(0);
          const score = (m: (typeof moves)[number]) => (m.result.holed ? -1 : at(v, m.result.end.y * hole.w + m.result.end.x));
          return at([...moves].sort((a, b) => score(a) - score(b)), 0);
        });
      }
      nextHole(g);
    }
    for (const p of g.players) {
      expect(p.scores.every((s) => s !== null && s >= 1 && s <= MAX_STROKES)).toBe(true);
    }
  });

  it('allows exactly one free tee re-roll, then mulligans', () => {
    const g = newGame(0, ['Solo']);
    expect(canTeeReroll(g)).toBe(false);
    roll(g, 2);
    expect(canTeeReroll(g)).toBe(true);
    teeReroll(g, 5);
    expect(defined(g.dice).value).toBe(5);
    expect(canTeeReroll(g)).toBe(false);
    expect(() => {
      teeReroll(g, 3);
    }).toThrow();
    expect(canMulligan(g)).toBe(true);
    mulligan(g, 6);
    expect(defined(g.dice).value).toBe(6);
    expect(at(g.players, 0).mulligans).toBe(MULLIGANS_PER_ROUND - 1);
    // After the tee shot, no more free re-rolls.
    const m = at(availableMoves(g), 0);
    shoot(g, m.dir, m.dist);
    if (!g.holeDone) {
      roll(g, 1);
      expect(canTeeReroll(g)).toBe(false);
    }
  });

  it('runs out of mulligans after six', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 1);
    for (let i = 0; i < MULLIGANS_PER_ROUND; i++) mulligan(g, 1);
    expect(canMulligan(g)).toBe(false);
    expect(() => {
      mulligan(g, 2);
    }).toThrow();
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
    expect(() => {
      roll(g, 4);
    }).toThrow();
    expect(() => shoot(g, 0, 3)).toThrow(); // 3 is not 4+1 nor a putt
  });

  it('rejects die values outside 1..6', () => {
    const g = newGame(0, ['Solo']);
    for (const bad of [0, 7, 2.5, -1]) {
      expect(() => {
        roll(g, bad);
      }).toThrow(/bad die value/);
    }
    expect(g.dice).toBeNull();
  });

  it('passes the turn to the next player on the tee', () => {
    const g = newGame(0, ['A', 'B']);
    roll(g, 3);
    const m = at(availableMoves(g), 0);
    shoot(g, m.dir, m.dist);
    expect(g.current).toBe(1);
  });

  it('picks the ball up at the stroke limit', () => {
    const g = newGame(0, ['Solo']);
    // Putt back and forth until the limit.
    for (let i = 0; i < MAX_STROKES && !g.holeDone; i++) puttWithoutHoling(g);
    expect(g.holeDone).toBe(true);
    expect(at(at(g.players, 0).scores, 0)).toBe(MAX_STROKES);
    expect(at(g.balls, 0).pickedUp).toBe(true);
  });
});

describe('new game', () => {
  it('takes 1-4 players with default names, colours, a blank card and full mulligans', () => {
    expect(() => newGame(0, [])).toThrow();
    expect(() => newGame(0, ['A', 'B', 'C', 'D', 'E'])).toThrow();
    const g = newGame(1, ['  Ann ', '', 'Cy', '   ']);
    expect(g.players.map((p) => p.name)).toEqual(['Ann', 'Player 2', 'Cy', 'Player 4']);
    expect(g.players.map((p) => p.color)).toEqual(PLAYER_COLORS);
    const tee = currentHole(g).tee;
    for (const p of g.players) {
      expect(p.scores).toEqual(Array<null>(HOLES_IN_ROUND).fill(null));
      expect(p.mulligans).toBe(MULLIGANS_PER_ROUND);
    }
    expect(g.balls).toHaveLength(4);
    for (const b of g.balls) expect(b).toEqual({ pos: tee, strokes: 0, holed: false, pickedUp: false, shots: [] });
    expect(g).toMatchObject({ holeIndex: 0, current: 0, dice: null, holeDone: false, finished: false });
  });
});

describe('scoring', () => {
  it('counts every shot, putts included, as a stroke and records it', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 3);
    const hit = findMove(availableMoves(g), (m) => m.kind === 'hit' && !m.result.holed, 'non-holing hit');
    const { record } = shoot(g, hit.dir, hit.dist);
    expect(record).toMatchObject({ kind: 'hit', dist: 4, from: currentHole(g).tee, end: hit.result.end });
    puttWithoutHoling(g);
    const ball = at(g.balls, 0);
    expect(ball.strokes).toBe(2);
    expect(ball.shots.map((s) => s.kind)).toEqual(['hit', 'putt']);
    expect(ball.pos).toEqual(at(ball.shots, 1).end);
    // Nothing is written to the card until the hole is finished.
    expect(at(at(g.players, 0).scores, 0)).toBeNull();
  });

  it('re-rolls and mulligans never cost a stroke', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 1);
    teeReroll(g, 2);
    mulligan(g, 3);
    expect(currentBall(g).strokes).toBe(0);
    // A mulligan keeps the spent tee re-roll spent.
    expect(defined(g.dice).teeRerolled).toBe(true);
    expect(canTeeReroll(g)).toBe(false);
  });

  it('writes the stroke count to the card when the ball is holed', () => {
    const g = newGame(0, ['Solo']);
    puttWithoutHoling(g);
    puttWithoutHoling(g);
    holeOutWithPutt(g);
    const ball = at(g.balls, 0);
    expect(ball).toMatchObject({ holed: true, strokes: 3, pos: currentHole(g).cup });
    expect(at(ball.shots, 2)).toMatchObject({ kind: 'putt', holed: true });
    expect(at(at(g.players, 0).scores, 0)).toBe(3);
    expect(g.holeDone).toBe(true);
    expect(g.dice).toBeNull();
    expect(() => {
      roll(g, 3);
    }).toThrow();
  });

  it('holes a hit that overshoots the cup by one space', () => {
    const g = newGame(0, ['Solo']);
    const { pos, dir, die } = overshootSetup(g);
    currentBall(g).pos = { ...pos };
    roll(g, die);
    const dist = diceDistance(currentHole(g), pos, die);
    const { result, record } = shoot(g, dir, dist);
    expect(record).toMatchObject({ kind: 'hit', dist, holed: true });
    expect(result.end).toEqual(currentHole(g).cup);
    expect(at(at(g.players, 0).scores, 0)).toBe(1);
  });

  it('totals the card and scores it against par, ignoring unplayed holes', () => {
    const scores = Array<number | null>(HOLES_IN_ROUND).fill(null);
    const p: PlayerState = { name: 'A', color: '#000', scores, mulligans: 0 };
    expect(totalStrokes(p)).toBe(0);
    expect(toPar(p)).toBe(0);
    // Holes 1-3 are par 4, 4 and 3.
    scores[0] = holePar(0) - 2;
    scores[1] = holePar(1);
    scores[2] = holePar(2) + 3;
    expect(totalStrokes(p)).toBe(4 + 4 + 3 + 1);
    expect(toPar(p)).toBe(1);
    scores.forEach((_, i) => (scores[i] = holePar(i)));
    expect(totalStrokes(p)).toBe(ROUND_PAR);
    expect(ROUND_PAR).toBe(72);
    expect(toPar(p)).toBe(0);
  });

  it('names scores relative to par', () => {
    const par = 6; // longer than any hole, so every name below par is reachable
    expect(scoreName(1, 5)).toBe('Hole in one!');
    expect(scoreName(par - 4, par)).toBe('Condor!');
    expect(scoreName(par - 3, par)).toBe('Albatross!');
    expect(scoreName(par - 2, par)).toBe('Eagle!');
    expect(scoreName(par - 1, par)).toBe('Birdie!');
    expect(scoreName(par, par)).toBe('Par');
    expect(scoreName(par + 1, par)).toBe('Bogey');
    expect(scoreName(par + 2, par)).toBe('Double bogey');
    expect(scoreName(MAX_STROKES, 4)).toBe(`+${String(MAX_STROKES - 4)}`);
    expect([formatToPar(0), formatToPar(3), formatToPar(-2)]).toEqual(['E', '+3', '-2']);
  });

  it('keeps mulligans for the whole course, not per hole', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 1);
    mulligan(g, 2);
    const m = findMove(availableMoves(g), (o) => o.kind === 'putt' && !o.result.holed, 'non-holing putt');
    shoot(g, m.dir, m.dist);
    holeOutWithPutt(g);
    nextHole(g);
    expect(at(g.players, 0).mulligans).toBe(MULLIGANS_PER_ROUND - 1);
  });
});

describe('turn order', () => {
  it.each([1, 2, 3, 4])('tees hole 1 off in setup order with %i player(s)', (n) => {
    const g = newGame(0, Array.from({ length: n }, (_, i) => `P${String(i + 1)}`));
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
      order.push(g.current);
      puttWithoutHoling(g);
    }
    expect(order).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it('skips players who have holed out and ends the hole when everyone is done', () => {
    const g = newGame(0, ['A', 'B', 'C', 'D']);
    puttWithoutHoling(g); // A
    holeOutWithPutt(g); // B holes in 1
    expect(g.current).toBe(2);
    puttWithoutHoling(g); // C
    puttWithoutHoling(g); // D
    expect(g.current).toBe(0); // A is away; B is skipped from now on
    holeOutWithPutt(g); // A holes in 2
    expect(g.current).toBe(2);
    holeOutWithPutt(g); // C holes in 2
    expect(g.current).toBe(3);
    expect(g.holeDone).toBe(false);
    puttWithoutHoling(g); // D
    expect(g.current).toBe(3); // only D is left: D plays again
    holeOutWithPutt(g); // D holes in 3
    expect(g.holeDone).toBe(true);
    expect(g.players.map((p) => p.scores[0])).toEqual([2, 1, 2, 3]);
    expect(availableMoves(g)).toEqual([]);
  });

  it('gives the honour on the next hole to the best score, ties to the earlier player', () => {
    const g = newGame(0, ['A', 'B', 'C']);
    expect(() => {
      nextHole(g);
    }).toThrow(/hole not finished/);
    puttWithoutHoling(g); // A
    puttWithoutHoling(g); // B
    holeOutWithPutt(g); // C holes in 1
    holeOutWithPutt(g); // A holes in 2
    holeOutWithPutt(g); // B holes in 2
    nextHole(g);
    expect(g.holeIndex).toBe(1);
    expect(g.current).toBe(2);
    expect(g.holeDone).toBe(false);
    expect(g.balls.every((b) => b.strokes === 0 && !b.holed && b.shots.length === 0)).toBe(true);
    expect(g.balls.map((b) => b.pos)).toEqual(g.players.map(() => currentHole(g).tee));

    // Hole 2 (C tees off): A and B tie on 1, C takes 2 -> A, the earlier of the tied players, has the honour.
    puttWithoutHoling(g); // C
    holeOutWithPutt(g); // A holes in 1
    holeOutWithPutt(g); // B holes in 1
    expect(g.current).toBe(2);
    holeOutWithPutt(g); // C holes in 2
    expect(g.players.map((p) => p.scores[1])).toEqual([1, 1, 2]);
    nextHole(g);
    expect(g.current).toBe(0);
  });

  it('finishes the round after the last hole', () => {
    const g = newGame(0, ['A', 'B']);
    for (let h = 0; h < HOLES_IN_ROUND; h++) {
      expect(g.holeIndex).toBe(h);
      expect(currentHole(g).number).toBe(h + 1);
      holeOutWithPutt(g);
      holeOutWithPutt(g);
      expect(g.finished).toBe(false);
      nextHole(g);
    }
    expect(g.finished).toBe(true);
    expect(g.holeIndex).toBe(HOLES_IN_ROUND - 1);
    for (const p of g.players) {
      expect(totalStrokes(p)).toBe(18);
      expect(toPar(p)).toBe(18 - 72);
    }
    expect(availableMoves(g)).toEqual([]);
  });
});

describe('tap-in (auto-putt)', () => {
  it('holes a ball next to the cup in exactly one stroke, with no roll', () => {
    const g = newGame(0, ['Solo']);
    puttWithoutHoling(g);
    currentBall(g).pos = { ...spotNextToCup(g).pos };
    expect(autoPuttMove(g)).not.toBeNull();
    expect(availableMoves(g)).toEqual([]);
    expect(() => {
      roll(g, 3);
    }).toThrow(/cannot roll now/);
    const { result, record } = autoPutt(g);
    expect(result.holed).toBe(true);
    expect(record).toMatchObject({ kind: 'putt', dist: 1, holed: true, auto: true, end: currentHole(g).cup });
    const ball = at(g.balls, 0);
    expect(ball).toMatchObject({ holed: true, strokes: 2, pos: currentHole(g).cup });
    expect(at(at(g.players, 0).scores, 0)).toBe(2);
    expect(at(g.players, 0).mulligans).toBe(MULLIGANS_PER_ROUND);
    expect(g.dice).toBeNull();
    expect(g.holeDone).toBe(true);
    expect(autoPuttMove(g)).toBeNull();
  });

  it.each([
    ['straight', false],
    ['diagonal', true],
  ])('tap-ins from a %s neighbour of the cup', (_, diagonal) => {
    const g = newGame(1, ['Solo']);
    const { pos, dir } = spotNextToCup(g, diagonal);
    currentBall(g).pos = { ...pos };
    expect(autoPuttMove(g)?.dir).toBe(dir);
    expect(autoPutt(g).record).toMatchObject({ dir, holed: true, auto: true });
    expect(at(g.balls, 0).strokes).toBe(1);
  });

  it('still rolls from 2 or more dots out', () => {
    const g = newGame(0, ['Solo']);
    const hole = currentHole(g);
    expect(autoPuttMove(g)).toBeNull(); // on the tee
    expect(() => autoPutt(g)).toThrow(/no tap-in due/);
    // 2 dots out, on the green: roll, then putt only.
    const two = defined(
      [...Array(25).keys()]
        .map((i) => ({ x: hole.cup.x + (i % 5) - 2, y: hole.cup.y + Math.floor(i / 5) - 2 }))
        .find((p) => dotsApart(p, hole.cup) === 2 && isLandable(hole, p)),
      '2-dot spot',
    );
    currentBall(g).pos = two;
    expect(autoPuttMove(g)).toBeNull();
    roll(g, 5);
    const moves = availableMoves(g);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.kind === 'putt' && m.dist === 1)).toBe(true);
  });

  it('skips a player who tapped in off the tee and gives them the honour', () => {
    const g = newGame(0, ['A', 'B', 'C', 'D']);
    puttWithoutHoling(g); // A
    puttWithoutHoling(g); // B
    puttWithoutHoling(g); // C
    expect(g.current).toBe(3);
    // D's ball sits next to the cup (as a slope or short shot could leave it): D's tee turn is a tap-in.
    currentBall(g).pos = { ...spotNextToCup(g).pos };
    expect(autoPuttMove(g)).not.toBeNull();
    autoPutt(g);
    expect(at(g.balls, 3)).toMatchObject({ holed: true, strokes: 1 });
    for (let i = 0; i < 3; i++) {
      expect(g.current).not.toBe(3); // D is skipped from now on
      holeOutWithPutt(g);
    }
    expect(g.holeDone).toBe(true);
    expect(g.players.map((p) => p.scores[0])).toEqual([2, 2, 2, 1]);
    nextHole(g);
    expect(g.current).toBe(3); // D's tap-in made the best score: D has the honour
  });

  it('gives the honour on the next hole to a player who tapped in for the best score', () => {
    const g = newGame(0, ['A', 'B', 'C', 'D']);
    puttWithoutHoling(g); // A
    currentBall(g).pos = { ...spotNextToCup(g).pos };
    autoPutt(g); // B holes in 1
    expect(g.current).toBe(2);
    for (let i = 0; i < 3; i++) holeOutWithPutt(g); // C, D, A
    nextHole(g);
    expect(g.current).toBe(1);
  });

  it('plays a turn whose die is already showing (older save) by hand', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 4);
    const { pos, dir } = spotNextToCup(g);
    currentBall(g).pos = { ...pos };
    expect(autoPuttMove(g)).toBeNull();
    const putt = findMove(availableMoves(g), (m) => m.dir === dir && m.dist === 1 && m.result.holed);
    const { record } = shoot(g, putt.dir, putt.dist);
    expect(record.holed).toBe(true);
    expect('auto' in record).toBe(false);
  });

  it('holes (not picks up) a tap-in that is the last allowed stroke', () => {
    const g = newGame(0, ['Solo']);
    currentBall(g).strokes = MAX_STROKES - 1;
    currentBall(g).pos = { ...spotNextToCup(g).pos };
    autoPutt(g);
    expect(at(g.balls, 0)).toMatchObject({ holed: true, pickedUp: false, strokes: MAX_STROKES });
    expect(at(at(g.players, 0).scores, 0)).toBe(MAX_STROKES);
  });

  it('saves and reloads a round with a tap-in in it', () => {
    const g = newGame(0, ['A', 'B']);
    holeOutWithPutt(g);
    const loaded = defined(loadState(JSON.parse(JSON.stringify(g))), 'loaded state');
    expect(loaded).toEqual(g);
    expect(at(at(loaded.balls, 0).shots, 0).auto).toBe(true);
  });
});

describe('auto-hole (a roll that can reach the cup plays itself)', () => {
  it('plays a hit that can hole straight into the cup: one stroke, no tap', () => {
    const g = newGame(0, ['Solo']);
    const { pos, dir, die } = overshootSetup(g);
    currentBall(g).pos = { ...pos };
    expect(autoHoleMove(g)).toBeNull(); // nothing rolled yet
    roll(g, die);
    const move = defined(autoHoleMove(g), 'auto-hole move');
    expect(move).toMatchObject({ dir, kind: 'hit' });
    expect(move.result.holed).toBe(true);
    const { result, record } = autoHole(g);
    expect(result.end).toEqual(currentHole(g).cup);
    expect(record).toMatchObject({ kind: 'hit', dir, holed: true });
    expect(record.auto).toBeUndefined(); // only tap-ins are marked auto (their banner)
    expect(at(g.balls, 0)).toMatchObject({ holed: true, strokes: 1, pos: currentHole(g).cup });
    expect(at(at(g.players, 0).scores, 0)).toBe(1);
    expect(g.dice).toBeNull();
    expect(g.holeDone).toBe(true);
    // Never twice: nothing more is due, and the hole can't be played on.
    expect(autoHoleMove(g)).toBeNull();
    expect(autoPuttMove(g)).toBeNull();
    expect(() => autoHole(g)).toThrow(/cannot reach the cup/);
  });

  it('holes a 2-dot green putt rolled with a 2, counting exactly one more stroke', () => {
    const g = newGame(0, ['Solo']);
    puttWithoutHoling(g);
    const hole = currentHole(g);
    const two = defined(
      [...Array(25).keys()]
        .map((i) => ({ x: hole.cup.x + (i % 5) - 2, y: hole.cup.y + Math.floor(i / 5) - 2 }))
        .find((p) => dotsApart(p, hole.cup) === 2 && isLandable(hole, p) && movesForRoll(hole, p, 2).some((m) => m.result.holed)),
      '2-dot spot with a clear putt',
    );
    currentBall(g).pos = two;
    expect(autoPuttMove(g)).toBeNull();
    roll(g, 2);
    expect(autoHoleMove(g)).toMatchObject({ kind: 'putt', dist: 2 });
    autoHole(g);
    expect(at(g.balls, 0)).toMatchObject({ holed: true, strokes: 2 });
    expect(at(at(g.players, 0).scores, 0)).toBe(2);
  });

  it('plays nothing when the roll cannot reach the cup: the targets are offered as before', () => {
    const g = newGame(0, ['Solo']);
    roll(g, 4); // from the tee
    expect(autoHoleMove(g)).toBeNull();
    expect(() => autoHole(g)).toThrow(/cannot reach the cup/);
    expect(availableMoves(g).length).toBeGreaterThan(0);
    expect(currentBall(g).strokes).toBe(0);
    expect(g.dice?.value).toBe(4);
  });

  it('also follows a mulligan that can reach the cup', () => {
    const g = newGame(0, ['Solo']);
    const { pos, die } = overshootSetup(g);
    puttWithoutHoling(g);
    currentBall(g).pos = { ...pos };
    const hole = currentHole(g);
    const miss = defined(
      [1, 2, 3, 4, 5, 6].find((v) => !movesForRoll(hole, pos, v).some((m) => m.result.holed)),
      'a roll that misses',
    );
    roll(g, miss);
    expect(autoHoleMove(g)).toBeNull();
    mulligan(g, die);
    expect(autoHoleMove(g)).not.toBeNull();
    autoHole(g);
    expect(at(g.balls, 0)).toMatchObject({ holed: true, strokes: 2 });
  });

  it('passes the turn on in a 4-player game like any shot', () => {
    const g = newGame(0, ['A', 'B', 'C', 'D']);
    const { pos, die } = overshootSetup(g);
    currentBall(g).pos = { ...pos };
    roll(g, die);
    autoHole(g);
    expect(g.current).toBe(1);
    expect(g.holeDone).toBe(false);
    expect(at(g.balls, 0).holed).toBe(true);
    expect(at(g.balls, 1).strokes).toBe(0);
  });
});

describe('saved rounds', () => {
  it('drops a legacy `mode`, `golf` and per-shot `club` from a save it can carry on', () => {
    const g = newGame(2, ['A', 'B']);
    roll(g, 4);
    const m = at(availableMoves(g), 0);
    shoot(g, m.dir, m.dist);
    // As written by the two-mode version: a mode, no die mid-turn, and a club on each shot.
    const saved = structuredClone(g);
    Object.assign(at(at(saved.balls, 0).shots, 0), { club: 'iron' });
    const loaded = defined(loadState({ ...saved, mode: 'speed', golf: 'proper' }), 'loaded state');
    expect('mode' in loaded).toBe(false);
    expect('golf' in loaded).toBe(false);
    expect('club' in at(at(loaded.balls, 0).shots, 0)).toBe(false);
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

  it('discards an old 12-hole par-6 round in progress (as saved by 93f049e, or before Proper golf) without throwing', () => {
    expect(loadState(structuredClone(OLD_12_HOLE_SAVE))).toBeNull();
    expect(loadState(structuredClone(OLD_PRE_PROPER_SAVE))).toBeNull();
    expect(isValidState(OLD_12_HOLE_SAVE)).toBe(false);
    // Even if its card is padded to 18, a round marked as the old mode is not resumed.
    const padded = {
      ...structuredClone(OLD_12_HOLE_SAVE),
      players: OLD_12_HOLE_SAVE.players.map((p) => ({ ...p, scores: [...p.scores, ...Array<null>(6).fill(null)] })),
    };
    expect(padded.players.map((p) => p.scores.length)).toEqual([18, 18]);
    expect(loadState(padded)).toBeNull();
    // ...and a fresh 18-hole round starts from there.
    const g = newGame(OLD_12_HOLE_SAVE.course, OLD_12_HOLE_SAVE.players.map((p) => p.name));
    expect(g.players.map((p) => p.scores.length)).toEqual([18, 18]);
  });

  it('resumes a Proper golf round saved while it was a choice (golf: proper)', () => {
    const g = newGame(3, ['A', 'B']);
    skipToHole(g, 10);
    const old = { ...structuredClone(g), golf: 'proper' };
    expect(loadState(old)).toEqual(g);
  });

  it('never throws on odd saved data', () => {
    const odd: unknown[] = [
      undefined,
      0,
      'x',
      [],
      [1, 2],
      { version: 1 },
      { version: 1, golf: 7, players: [], balls: [] },
      { version: 1, course: 0, holeIndex: 0, players: [null], balls: [null] },
      { version: 1, course: 0, holeIndex: 0, players: [{ scores: 'no' }], balls: [{}] },
      { version: 1, course: 9, holeIndex: 0, players: [{ scores: Array(18).fill(null) }], balls: [{}] },
      { version: 1, course: 0, holeIndex: 18, players: [{ scores: Array(18).fill(null) }], balls: [{}] },
    ];
    for (const o of odd) expect(loadState(o), JSON.stringify(o)).toBeNull();
  });
});

describe('deep link (?play=&players=&hole=)', () => {
  const link = (s: string) => parseDeepLink(new URLSearchParams(s));

  it('clamps the hole to 1..18 and ignores an old golf= or mode= param', () => {
    expect(link('play=0&hole=5').holeIndex).toBe(4);
    expect(link('play=0&hole=13').holeIndex).toBe(12);
    expect(link('play=0&hole=18').holeIndex).toBe(HOLES_IN_ROUND - 1);
    for (const h of ['19', '99', '1e9']) expect(link(`play=0&hole=${h}`).holeIndex, h).toBe(HOLES_IN_ROUND - 1);
    for (const q of ['golf=default', 'golf=proper', 'golf=junk', 'mode=speed']) {
      expect(link(`play=0&${q}&hole=13`).holeIndex, q).toBe(12);
      expect(link(`play=0&${q}&hole=99`).holeIndex, q).toBe(HOLES_IN_ROUND - 1);
    }
    for (const h of ['0', '-3', 'abc', '', 'NaN', 'Infinity']) expect(link(`play=0&hole=${h}`).holeIndex, h).toBe(0);
    expect(link('play=0').holeIndex).toBe(0);
  });

  it('clamps course and players to what exists', () => {
    expect(link('play=99&players=9')).toEqual({ course: COURSES.length - 1, players: PLAYER_COLORS.length, holeIndex: 0 });
    expect(link('play=-1&players=0')).toEqual({ course: 0, players: 1, holeIndex: 0 });
    expect(link('play=junk&players=junk')).toEqual({ course: 0, players: 1, holeIndex: 0 });
    expect(link('play=2&players=3&hole=7')).toEqual({ course: 2, players: 3, holeIndex: 6 });
  });

  it('skips to the hole without finishing the round, even past the last hole', () => {
    const g = newGame(0, ['A']);
    skipToHole(g, link('play=0&hole=40').holeIndex);
    expect(g.holeIndex).toBe(HOLES_IN_ROUND - 1);
    expect(currentHole(g).par).toBe(at(PROPER_PARS, 17));
    expect(g.finished).toBe(false);
    const h = newGame(1, ['A', 'B']);
    skipToHole(h, 99);
    expect(h.holeIndex).toBe(HOLES_IN_ROUND - 1);
    expect(h.finished).toBe(false);
    expect(h.holeDone).toBe(false);
  });
});
