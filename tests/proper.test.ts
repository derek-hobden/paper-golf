import { describe, expect, it } from 'vitest';
import { holeToAscii } from '../src/engine/ascii';
import {
  COURSES,
  GRID_H,
  GRID_W,
  HOLES_PER_COURSE,
  PAR_WINDOWS,
  PROPER_HOLES,
  PROPER_PARS,
  generateHole,
  generateProperHole,
  generateProperHoleWithStats,
} from '../src/engine/generator';
import { PAR, isLandable, legalMoves, samePos } from '../src/engine/rules';
import { diceExpectation } from '../src/engine/solver';
import {
  cardTotals,
  currentHole,
  deepLinkGolf,
  holePar,
  holesInRound,
  isValidState,
  loadState,
  newGame,
  nextHole,
  parseDeepLink,
  roundPars,
  scoreName,
  skipToHole,
  toPar,
  totalStrokes,
} from '../src/game/game';
import { at, defined, holeOutWithPutt } from './helpers';

// Accepted seed for every Proper golf hole, course by course (pinned like the default holes' seeds).
const PROPER_SEEDS = [
  [125268262, 4203500758, 995093756, 999913165, 1760818581, 2768784701, 603763360, 1507915787, 2416106529, 1303974881, 3417135444, 1100058303, 4286968866, 3155570548, 4065488888, 3807179209, 3861551830, 1539912294],
  [2771319797, 520236122, 2568381999, 1421716203, 3400171334, 122800110, 2175088755, 3161358471, 1972151469, 4024473906, 1777652615, 2753558067, 436964526, 3593974598, 1342956843, 3391086512, 1148391429, 2978513878],
  [1139172740, 4190810667, 940116481, 4121085637, 1807029096, 3784923551, 1735239170, 1520836342, 2626417632, 1325397276, 3370893225, 1121413186, 3138707584, 1999167336, 3066264410, 1795208094, 3091283868, 1485821083],
  [2789874700, 2479435549, 3718607753, 1477870638, 2384030432, 70590487, 3306565077, 899728340, 826257675, 3968106187, 759678497, 1862469419, 379626091, 405668426, 347664525, 519874384, 3238111419, 3173231891],
  [3380779709, 1727726662, 4122609511, 4033469762, 2785418766, 2793467987, 3976812859, 3502432719, 113203101, 2631100930, 3357926458, 2405721380, 3202349831, 4249624657, 2070967868, 689723974, 1032468505, 3538627490]
];

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const ALL = COURSES.flatMap((_, c) => Array.from({ length: PROPER_HOLES }, (_, i) => ({ c, n: i + 1 })));

describe('Proper golf course', () => {
  it('has 18 holes: 4 par 3s, 10 par 4s, 4 par 5s, out 36, in 36, par 72', () => {
    expect(PROPER_HOLES).toBe(18);
    const count = (par: number) => PROPER_PARS.filter((p) => p === par).length;
    expect([count(3), count(4), count(5)]).toEqual([4, 10, 4]);
    expect(PROPER_PARS.every((p) => p >= 3 && p <= 5)).toBe(true);
    expect(sum(PROPER_PARS.slice(0, 9))).toBe(36);
    expect(sum(PROPER_PARS.slice(9))).toBe(36);
    expect(sum(roundPars('proper'))).toBe(72);
    // Realistic order: never three of the same short or long par in a row, and each nine has both par 3s and par 5s.
    for (const nine of [PROPER_PARS.slice(0, 9), PROPER_PARS.slice(9)]) {
      expect(nine.filter((p) => p === 3)).toHaveLength(2);
      expect(nine.filter((p) => p === 5)).toHaveLength(2);
    }
  });

  it('leaves the default mode alone: 12 holes, every one par 6', () => {
    expect(holesInRound('default')).toBe(HOLES_PER_COURSE);
    expect(HOLES_PER_COURSE).toBe(12);
    expect(PAR).toBe(6);
    expect(roundPars('default')).toEqual(Array<number>(12).fill(6));
    for (let c = 0; c < COURSES.length; c++)
      for (let n = 1; n <= HOLES_PER_COURSE; n++) expect(generateHole(c, n).par).toBe(6);
    const g = newGame(0, ['A']);
    expect(g.golf).toBe('default');
    expect(currentHole(g)).toBe(generateHole(0, 1));
  });

  it('keeps the same hole layouts (pinned seeds)', () => {
    expect(COURSES.map((_, c) => Array.from({ length: PROPER_HOLES }, (_, i) => generateProperHoleWithStats(c, i + 1).hole.seed))).toEqual(
      PROPER_SEEDS,
    );
  });

  it('never repeats a layout, within Proper golf or from the default holes', () => {
    const maps = new Set(ALL.map(({ c, n }) => holeToAscii(generateProperHole(c, n)).join('\n')));
    expect(maps.size).toBe(ALL.length);
    for (let c = 0; c < COURSES.length; c++)
      for (let n = 1; n <= HOLES_PER_COURSE; n++) expect(maps.has(holeToAscii(generateHole(c, n)).join('\n'))).toBe(false);
  });

  it.each(ALL)('course $c hole $n is valid, solvable and plays to its par', ({ c, n }) => {
    const { hole, stats } = generateProperHoleWithStats(c, n);
    const par = at(PROPER_PARS, n - 1);
    expect(hole).toMatchObject({ course: c, number: n, par, w: GRID_W, h: GRID_H });
    expect(at(hole.cells, hole.tee.y * hole.w + hole.tee.x).t).toBe('fairway');
    expect(at(hole.cells, hole.cup.y * hole.w + hole.cup.x).t).toBe('fairway');
    expect(samePos(hole.tee, hole.cup)).toBe(false);
    const v = diceExpectation(hole);
    for (let y = 0; y < hole.h; y++)
      for (let x = 0; x < hole.w; x++) {
        if (!isLandable(hole, { x, y })) continue;
        expect(Number.isFinite(at(v, y * hole.w + x))).toBe(true);
        if (!samePos({ x, y }, hole.cup)) expect(legalMoves(hole, { x, y }, 1).length).toBeGreaterThan(0);
      }
    const [lo, hi] = defined(PAR_WINDOWS[par], 'par window');
    expect(stats.diceExpected).toBeGreaterThanOrEqual(lo);
    expect(stats.diceExpected).toBeLessThanOrEqual(hi);
  });

  it('scales the layout with the par: longer tee-to-cup for longer holes', () => {
    const span = (par: number) => {
      const holes = ALL.filter(({ n }) => at(PROPER_PARS, n - 1) === par).map(({ c, n }) => generateProperHole(c, n));
      return sum(holes.map((h) => h.tee.y - h.cup.y)) / holes.length;
    };
    expect(span(3)).toBeLessThan(span(4));
    expect(span(4)).toBeLessThan(span(5));
  });
});

describe('Proper golf round', () => {
  it('plays 18 holes, each against its own par, and finishes', () => {
    const g = newGame(2, ['A', 'B'], 'proper');
    expect(g.golf).toBe('proper');
    for (const p of g.players) expect(p.scores).toHaveLength(18);
    for (let h = 0; h < 18; h++) {
      expect(currentHole(g)).toBe(generateProperHole(2, h + 1));
      expect(currentHole(g).par).toBe(holePar('proper', h));
      while (!g.holeDone) holeOutWithPutt(g);
      nextHole(g);
    }
    expect(g.finished).toBe(true);
    for (const p of g.players) {
      expect(totalStrokes(p)).toBe(18);
      expect(toPar(p, 'proper')).toBe(18 - 72);
    }
  });

  it('totals the card: out, in and total par and strokes', () => {
    const p = newGame(0, ['A'], 'proper').players[0];
    const player = defined(p, 'player');
    expect(cardTotals(player, 'proper')).toEqual([
      { label: 'Out', par: 36, strokes: 0, toPar: 0, played: false },
      { label: 'In', par: 36, strokes: 0, toPar: 0, played: false },
      { label: 'Total', par: 72, strokes: 0, toPar: 0, played: false },
    ]);
    player.scores[0] = 5; // par 4
    player.scores[2] = 2; // par 3
    player.scores[9] = 4; // par 4
    expect(cardTotals(player, 'proper').map((t) => [t.label, t.par, t.strokes, t.toPar, t.played])).toEqual([
      ['Out', 36, 7, 0, true],
      ['In', 36, 4, 0, true],
      ['Total', 72, 11, 0, true],
    ]);
    expect(toPar(player, 'proper')).toBe(1 - 1 + 0);
    player.scores[17] = 7; // par 4
    expect(cardTotals(player, 'proper').map((t) => t.toPar)).toEqual([0, 3, 3]);
    expect(toPar(player, 'proper')).toBe(3);
    const d = defined(newGame(0, ['A']).players[0], 'player');
    expect(cardTotals(d, 'default')).toEqual([{ label: 'Total', par: 72, strokes: 0, toPar: 0, played: false }]);
    d.scores[0] = 5;
    expect(toPar(d)).toBe(-1);
  });

  it('names scores against the hole par', () => {
    expect(scoreName(2, 3)).toBe('Birdie!');
    expect(scoreName(3, 3)).toBe('Par');
    expect(scoreName(3, 5)).toBe('Eagle!');
    expect(scoreName(6, 4)).toBe('Double bogey');
    expect(scoreName(5)).toBe('Birdie!');
  });

  it('saves and loads a Proper golf round; older saves load as the default mode', () => {
    const g = newGame(1, ['A'], 'proper');
    skipToHole(g, 15);
    expect(loadState(JSON.parse(JSON.stringify(g)))).toEqual(g);
    const old: Record<string, unknown> = { ...newGame(1, ['A']) };
    delete old.golf;
    expect(defined(loadState(old)).golf).toBe('default');
    // Hole 16 does not exist in a 12-hole round, and a Proper golf card has 18 slots.
    expect(isValidState({ ...g, golf: 'default' })).toBe(false);
    expect(isValidState({ ...g, golf: 'mini' })).toBe(false);
  });
});

describe('deep link hole clamping by mode', () => {
  const link = (s: string) => parseDeepLink(new URLSearchParams(s));

  it('clamps to 1..18 in Proper golf', () => {
    expect(deepLinkGolf(new URLSearchParams('play=0&golf=proper'))).toBe('proper');
    expect(link('play=0&golf=proper&hole=13').holeIndex).toBe(12);
    expect(link('play=0&golf=proper&hole=18').holeIndex).toBe(17);
    for (const h of ['19', '99', '1e9']) expect(link(`play=0&golf=proper&hole=${h}`).holeIndex, h).toBe(17);
    for (const h of ['0', '-3', 'abc', '']) expect(link(`play=0&golf=proper&hole=${h}`).holeIndex, h).toBe(0);
  });

  it('clamps to 1..12 in the default mode (any other golf value)', () => {
    for (const q of ['play=0', 'play=0&golf=default', 'play=0&golf=junk']) {
      expect(deepLinkGolf(new URLSearchParams(q)), q).toBe('default');
      expect(link(`${q}&hole=13`).holeIndex, q).toBe(HOLES_PER_COURSE - 1);
      expect(link(`${q}&hole=18`).holeIndex, q).toBe(HOLES_PER_COURSE - 1);
    }
  });

  it('skips to the last Proper golf hole without finishing the round', () => {
    const g = newGame(0, ['A'], 'proper');
    skipToHole(g, link('play=0&golf=proper&hole=40').holeIndex);
    expect(g.holeIndex).toBe(17);
    expect(g.finished).toBe(false);
    expect(currentHole(g).par).toBe(at(PROPER_PARS, 17));
  });
});
