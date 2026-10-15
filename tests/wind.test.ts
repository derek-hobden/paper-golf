import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/rng';
import { applyWind, movesForRoll, onGreen, resolveShot } from '../src/engine/rules';
import { CALM, type Cell, type Dir, type Hole, type P, type Wind } from '../src/engine/types';
import { rollWind, windForHole, windLabel } from '../src/engine/wind';
import {
  HOLES_IN_ROUND,
  autoHole,
  autoHoleMove,
  availableMoves,
  currentBall,
  currentHole,
  holeWind,
  loadState,
  newGame,
  nextHole,
  roll,
  shoot,
  skipToHole,
  type GameState,
} from '../src/game/game';
import { at, defined, holeOutWithPutt, windOnlyHoleOut } from './helpers';

/** A w×h hole of rough with the given terrain overrides; cup at `cup`. */
function testHole(w: number, h: number, cup: P, overrides: Record<string, Cell> = {}): Hole {
  const cells: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(overrides[`${String(x)},${String(y)}`] ?? { t: 'rough' });
  return { course: 0, number: 1, seed: 1, w, h, cells, tee: { x: 0, y: h - 1 }, cup, par: 4 };
}

const wind = (strength: Wind['strength'], dir: Dir): Wind => ({ strength, dir });
const E: Dir = 2;
const NE: Dir = 1;

describe('wind roll', () => {
  it('is calm ~15%, strength 1 ~70%, strength 2 ~15%, and any of the 8 directions when blowing', () => {
    const rng = mulberry32(12345);
    const n = 40000;
    const byStrength = [0, 0, 0];
    const byDir = [0, 0, 0, 0, 0, 0, 0, 0];
    let blowing = 0;
    for (let i = 0; i < n; i++) {
      const w = rollWind(rng);
      byStrength[w.strength] = at(byStrength, w.strength) + 1;
      if (w.strength > 0) {
        blowing++;
        byDir[w.dir] = at(byDir, w.dir) + 1;
      } else expect(w).toEqual(CALM);
    }
    expect(Math.abs(at(byStrength, 0) / n - 0.15)).toBeLessThan(0.01);
    expect(Math.abs(at(byStrength, 1) / n - 0.7)).toBeLessThan(0.01);
    expect(Math.abs(at(byStrength, 2) / n - 0.15)).toBeLessThan(0.01);
    for (const c of byDir) expect(Math.abs(c / blowing - 1 / 8)).toBeLessThan(0.01);
  });

  it('is deterministic per round seed, course and hole, and varies across them', () => {
    expect(windForHole(7, 2, 5)).toEqual(windForHole(7, 2, 5));
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) for (let h = 0; h < HOLES_IN_ROUND; h++) seen.add(JSON.stringify(windForHole(seed, 0, h)));
    expect(seen.size).toBe(17); // calm plus 2 strengths × 8 directions
  });

  it('reads "Wind NE 2" in the HUD (no arrows), or Calm', () => {
    expect(windLabel(CALM)).toBe('Calm');
    expect(windLabel(wind(2, NE))).toBe('Wind NE 2');
    expect(windLabel(wind(1, 6))).toBe('Wind W 1');
  });
});

describe('applyWind (push the resting ball)', () => {
  const open = testHole(9, 9, { x: 8, y: 0 });

  it('pushes the ball strength squares downwind, diagonals one on each axis', () => {
    expect(applyWind(open, { x: 2, y: 4 }, wind(2, E))).toEqual({ end: { x: 4, y: 4 }, holed: false, moved: true });
    expect(applyWind(open, { x: 2, y: 4 }, wind(1, NE))).toEqual({ end: { x: 3, y: 3 }, holed: false, moved: true });
    expect(applyWind(open, { x: 2, y: 4 }, CALM)).toEqual({ end: { x: 2, y: 4 }, holed: false, moved: false });
  });

  it('stops early at the edge of the board', () => {
    expect(applyWind(open, { x: 7, y: 4 }, wind(2, E)).end).toEqual({ x: 8, y: 4 });
    expect(applyWind(open, { x: 8, y: 4 }, wind(2, E))).toEqual({ end: { x: 8, y: 4 }, holed: false, moved: false });
  });

  it('stops before water and trees, but pushes into sand', () => {
    const hz = testHole(9, 9, { x: 8, y: 0 }, { '4,4': { t: 'water' }, '3,2': { t: 'tree' }, '4,6': { t: 'sand' } });
    expect(applyWind(hz, { x: 2, y: 4 }, wind(2, E)).end).toEqual({ x: 3, y: 4 });
    expect(applyWind(hz, { x: 3, y: 4 }, wind(2, E)).moved).toBe(false);
    expect(applyWind(hz, { x: 1, y: 2 }, wind(2, E)).end).toEqual({ x: 2, y: 2 });
    expect(applyWind(hz, { x: 2, y: 6 }, wind(2, E)).end).toEqual({ x: 4, y: 6 });
  });

  it('holes the ball only when its final square is the cup', () => {
    const h = testHole(9, 9, { x: 5, y: 4 });
    expect(applyWind(h, { x: 4, y: 4 }, wind(1, E))).toEqual({ end: { x: 5, y: 4 }, holed: true, moved: true });
    expect(applyWind(h, { x: 3, y: 4 }, wind(2, E))).toEqual({ end: { x: 5, y: 4 }, holed: true, moved: true });
    // Blown over the cup: it does not drop.
    expect(applyWind(h, { x: 4, y: 4 }, wind(2, E))).toEqual({ end: { x: 6, y: 4 }, holed: false, moved: true });
  });
});

describe('wind on shots', () => {
  const h = testHole(12, 12, { x: 11, y: 0 });

  it('moves a hit’s final square but not its touchdown', () => {
    const calm = resolveShot(h, { x: 1, y: 6 }, E, 4);
    const blown = resolveShot(h, { x: 1, y: 6 }, E, 4, wind(2, 0));
    expect(calm.end).toEqual({ x: 5, y: 6 });
    expect(blown).toEqual({ legal: true, holed: false, landing: { x: 5, y: 6 }, end: { x: 5, y: 4 }, rolled: false, blown: true });
    // Calm, or a push the edge stops at once: no `blown` flag, the shot is drawn straight.
    expect(calm.blown).toBeUndefined();
    expect(resolveShot(h, { x: 1, y: 0 }, E, 4, wind(2, 0)).blown).toBeUndefined();
  });

  it('keeps a ball that dropped on the fly in the cup', () => {
    const c = testHole(12, 12, { x: 5, y: 6 });
    expect(resolveShot(c, { x: 1, y: 6 }, E, 4, wind(2, 0))).toMatchObject({ holed: true, end: { x: 5, y: 6 } });
  });

  it('never moves putts: green putts, the 1-dot putt and off-green 1-putts', () => {
    const c = testHole(12, 12, { x: 6, y: 6 });
    const w = wind(2, 6);
    for (const from of [{ x: 4, y: 6 }, { x: 5, y: 5 }, { x: 1, y: 9 }, { x: 10, y: 1 }])
      for (let r = 1; r <= 6; r++) {
        const calmPutts = movesForRoll(c, from, r).filter((m) => m.kind === 'putt');
        const windPutts = movesForRoll(c, from, r, w).filter((m) => m.kind === 'putt');
        expect(windPutts).toEqual(calmPutts);
        if (onGreen(c, from)) expect(movesForRoll(c, from, r, w)).toEqual(movesForRoll(c, from, r));
      }
  });

  it('moves every off-green hit by the wind', () => {
    const w = wind(1, 4);
    const from = { x: 1, y: 6 };
    const hits = movesForRoll(h, from, 4, w).filter((o) => o.kind === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const m of hits) {
      const calm = resolveShot(h, from, m.dir, m.dist);
      expect(m.result.end).toEqual(applyWind(h, calm.end, w).end);
    }
  });
});

describe('wind in the game', () => {
  it('rolls one wind per hole at its start, the same for every player, reproducible from the round seed', () => {
    const a = newGame(1, ['A', 'B'], 99);
    const b = newGame(1, ['A', 'B'], 99);
    for (let h = 0; h < HOLES_IN_ROUND; h++) {
      expect(holeWind(a)).toEqual(windForHole(99, 1, h));
      expect(holeWind(b)).toEqual(holeWind(a));
      const before = holeWind(a);
      while (!a.holeDone) holeOutWithPutt(a);
      expect(holeWind(a)).toEqual(before);
      if (h + 1 < HOLES_IN_ROUND) {
        nextHole(a);
        skipToHole(b, h + 1);
      }
    }
  });

  it('offers wind-adjusted hits, and the shot played ends where its marker showed', () => {
    const g = newGame(0, ['A']);
    g.wind = wind(2, 4);
    roll(g, 4);
    const hits = availableMoves(g).filter((m) => m.kind === 'hit' && !m.result.holed);
    const m = at(hits, 0);
    const calm = resolveShot(currentHole(g), currentBall(g).pos, m.dir, m.dist);
    expect(m.result.end).toEqual(applyWind(currentHole(g), calm.end, holeWind(g)).end);
    const { record } = shoot(g, m.dir, m.dist);
    expect(record.end).toEqual(m.result.end);
    expect(record.blown).toBe(true);
    expect(currentBall(g).pos).toEqual(m.result.end);
  });

  it('plays the auto shot when the wind carries a hit into the cup', () => {
    const g = newGame(0, ['A']);
    const s = windOnlyHoleOut(g);
    currentBall(g).pos = { ...s.pos };
    currentBall(g).strokes = 1;
    g.wind = CALM;
    roll(g, s.die);
    expect(autoHoleMove(g)).toBeNull();
    g.wind = s.wind;
    const auto = defined(autoHoleMove(g), 'auto shot');
    expect(auto.kind).toBe('hit');
    const { record } = autoHole(g);
    expect(record.holed).toBe(true);
    expect(at(g.players, 0).scores[0]).toBe(2);
  });

  it('loads an older save without wind as a calm round', () => {
    const g = newGame(0, ['A'], 5);
    const old: Partial<GameState> = { ...g };
    delete old.wind;
    delete old.windSeed;
    const loaded = defined(loadState(JSON.parse(JSON.stringify(old))), 'loaded');
    expect(holeWind(loaded)).toEqual(CALM);
    while (!loaded.holeDone) holeOutWithPutt(loaded);
    nextHole(loaded);
    expect(holeWind(loaded)).toEqual(CALM);
  });
});
