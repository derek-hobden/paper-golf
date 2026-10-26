/**
 * Forced carries: a hole whose tee and pin have nothing but water, a gorge or trees between them. Derek, 24 Oct 2026:
 * "In real life you could be forced to hit over a row of trees or a gorge or a river." The builder judges such a hole
 * by the shots the rules really offer (`finishableCells`), never by a path of ground, so what it accepts is what the
 * game can play.
 */
import { describe, expect, it } from 'vitest';
import {
  PIN_WALLED,
  UNREACHABLE,
  WEATHER_CARRY,
  decodeHole,
  draftToHole,
  encodeHole,
  readyHole,
  whyUnplayable,
  type Draft,
  type Par,
} from '../src/engine/builder';
import { GRID_H, GRID_W } from '../src/engine/generator';
import { cellAt, movesForRoll, resolveShot } from '../src/engine/rules';
import { diceExpectation, diceExpectedFromTee, finishableCells, puttComponent } from '../src/engine/solver';
import { CALM, type Cell, type Height, type Hole, type P, type Terrain, type Wind } from '../src/engine/types';
import { EVERY_WIND } from '../src/engine/wind';
import { newBuiltRound } from '../src/game/game';
import { at, defined } from './helpers';
import { playHoleTypically, seededD6 } from './sim';

const TEE: P = { x: 6, y: 17 };
const PIN: P = { x: 6, y: 9 };

/** A draft of `fill`, with a tee and a pin. */
function drawn(fill: (x: number, y: number) => Terrain, tee: P = TEE, cup: P = PIN, par: Par = 4): Draft {
  const cells: Cell[] = [];
  for (let y = 0; y < GRID_H; y += 1) for (let x = 0; x < GRID_W; x += 1) cells.push({ t: fill(x, y) });
  return { cells, tee, cup, par };
}

/** The hole a draft makes, through the builder's own check; it throws with the refusal when the builder refuses one. */
function playable(draft: Draft): Hole {
  const ready = readyHole(draft);
  if (!ready.ok) throw new Error(`the builder refused the hole: ${ready.reason}`);
  return ready.hole;
}

/** Fairway everywhere, with `rows` of `t` right across the page: no ground joins the tee to the pin. */
const band = (t: Terrain, rows: readonly number[]) => (_x: number, y: number) => (rows.includes(y) ? t : 'fairway');

const river = () => drawn(band('water', [13]));
const gorge = () => drawn(band('water', [10, 11, 12, 13, 14, 15, 16, 17]), { x: 6, y: 18 }, { x: 6, y: 2 });
const trees = () => drawn(band('tree', [13]));
/** Six rows of water: the full seven-space carry (a 6 from the fairway), which the rain's heavy air takes away. */
const widest = () => drawn(band('water', [10, 11, 12, 13, 14, 15]), { x: 6, y: 16 }, { x: 6, y: 9 });

/** A pin ringed by trees on rough: a hit from off the fairway cannot fly over them, and no putt crosses them. */
const walled = () =>
  drawn((x, y) => (Math.max(Math.abs(x - PIN.x), Math.abs(y - PIN.y)) === 1 ? 'tree' : 'rough'));

const cupKey = (hole: Hole) => hole.cup.y * hole.w + hole.cup.x;
const teeKey = (hole: Hole) => hole.tee.y * hole.w + hole.tee.x;

/** `draft` with every row from `rows[0]` to `rows[1]` set to height `z`. */
const banked = (draft: Draft, z: Height, rows: readonly [number, number]): Draft => ({
  ...draft,
  cells: draft.cells.map((c, i) => {
    const y = Math.floor(i / GRID_W);
    return y >= rows[0] && y <= rows[1] ? { ...c, z } : c;
  }),
});

/** Seven rows of water: a gorge no level shot carries, and exactly the eight dots a hit gets going one level down. */
const steepGorge = () => drawn(band('water', [11, 12, 13, 14, 15, 16, 17]), { x: 6, y: 18 }, { x: 6, y: 2 });

describe('a hole with a forced carry', () => {
  it('plays a river right across the page, with no ground joining the tee to the pin', () => {
    const hole = playable(river());
    // The check the builder used to make, and the reason it refused this hole: there is no path of putts at all.
    expect(puttComponent(hole, hole.tee).has(cupKey(hole))).toBe(false);
    expect(finishableCells(hole).has(teeKey(hole))).toBe(true);
    expect(whyUnplayable(hole)).toBeNull();

    // The carry is a hit over the water, and the par the player chose is the one it plays to.
    const dry = diceExpectedFromTee(hole);
    expect(dry).toBeLessThan(hole.par + 1);
    expect(dry).toBeGreaterThan(2);
    expect(diceExpectedFromTee(hole, true)).toBeLessThan(hole.par + 1.5);
  });

  it('plays a row of trees, which only a hit from the fairway can clear', () => {
    const hole = playable(trees());
    expect(puttComponent(hole, hole.tee).has(cupKey(hole))).toBe(false);
    expect(whyUnplayable(hole)).toBeNull();
    expect(diceExpectedFromTee(hole)).toBeLessThan(hole.par + 1);
    // The tee is fairway, so the hit flies over the trees; the same hit from the rough is refused.
    expect(cellAt(hole, hole.tee).t).toBe('fairway');
    const rough: Hole = { ...hole, cells: hole.cells.map((c, i) => (i === teeKey(hole) ? { t: 'rough' } : { ...c })) };
    expect(resolveShot(rough, rough.tee, 0, 5)).toMatchObject({ legal: false, reason: 'trees' });
  });

  it('refuses a gorge wider than any shot can carry, and says the gap is too wide', () => {
    expect(readyHole(gorge())).toEqual({ ok: false, reason: UNREACHABLE });
    // The longest hit in the game is seven spaces (a 6 from the fairway), so eight rows of water are a wall. The far
    // side is playable in itself: it is the tee that cannot be got out of.
    const hole = defined(draftToHole(gorge()), 'gorge hole');
    const reach = finishableCells(hole);
    expect(reach.has(teeKey(hole))).toBe(false);
    expect(reach.has(cupKey(hole))).toBe(true);
    expect(reach.size).toBeGreaterThan(1);
  });

  it('refuses a carry that only the fair weather can make', () => {
    // Seven spaces of water is the longest hit there is, so the hole plays in a dry calm and nowhere else: the rain
    // carries one space less, and a round takes the weather it is dealt.
    const hole = defined(draftToHole(widest()), 'widest hole');
    expect(finishableCells(hole).has(teeKey(hole))).toBe(true);
    expect(finishableCells(hole, CALM, true).has(teeKey(hole))).toBe(false);
    expect(readyHole(widest())).toEqual({ ok: false, reason: WEATHER_CARRY });
  });

  it('refuses a pin walled in by trees, and says nothing can reach it', () => {
    expect(readyHole(walled())).toEqual({ ok: false, reason: PIN_WALLED });
    // Not one square on the page can hole out: trees turn away every hit that is not from the fairway, and no putt
    // crosses them, so only the cup itself is left.
    const hole = defined(draftToHole(walled()), 'walled hole');
    expect([...finishableCells(hole)]).toEqual([cupKey(hole)]);
  });

  it('keeps the water rule on a carry: no shot ever rests in the river', () => {
    const hole = playable(river());
    const bank: P = { x: 6, y: 14 };
    // A putt into the river is not offered, and the river is why.
    expect(resolveShot(hole, bank, 0, 1)).toMatchObject({ legal: false, reason: 'water' });
    for (let roll = 1; roll <= 6; roll += 1) {
      const moves = movesForRoll(hole, hole.tee, roll);
      expect(moves.length).toBeGreaterThan(0);
      expect(moves.filter((m) => cellAt(hole, m.result.end).t === 'water')).toEqual([]);
    }
  });

  it('is played out by the typical player, who never has to walk round', () => {
    const hole = playable(river());
    const round = newBuiltRound(hole, ['Ada'], 1, 1);
    playHoleTypically(round, seededD6(7));
    expect(round.holeDone).toBe(true);
    const ball = at(round.balls, 0);
    expect(ball.holed).toBe(true);
    expect(ball.pos).toEqual(hole.cup);
  });

  it('carries a river hole through the share link unchanged', () => {
    const hole = playable(river());
    const token = defined(encodeHole(hole), 'token');
    const back = defined(decodeHole(token), 'decoded hole');
    expect(back.cells).toEqual(hole.cells);
    expect(whyUnplayable(back)).toBeNull();
  });
});

describe('a forced carry over elevation', () => {
  it('reads the ground’s height in what it says a carry can reach, and still holds it to every weather', () => {
    const level = defined(draftToHole(steepGorge()), 'gorge');
    expect(finishableCells(level).has(teeKey(level))).toBe(false);
    expect(readyHole(steepGorge())).toEqual({ ok: false, reason: UNREACHABLE });
    // A tee on a plateau, hitting a level down: the carry goes one dot further, just enough in a dry calm... (only the
    // height of the dot a level hit comes down on counts, and over a gorge that dot is the water, so a dip on the far
    // bank would lengthen nothing — the climb has to start under the ball.)
    const downhill = () => banked(steepGorge(), 1, [18, GRID_H - 1]);
    const down = defined(draftToHole(downhill()), 'gorge from a plateau');
    expect(finishableCells(down).has(teeKey(down))).toBe(true);
    // ...and nowhere else. A built hole takes the weather it is dealt, so the builder still refuses it.
    expect(finishableCells(down, CALM, true).has(teeKey(down))).toBe(false);
    expect(readyHole(downhill())).toEqual({ ok: false, reason: WEATHER_CARRY });
  });

  it('shortens every carry onto a plateau, so a gap the dry calm just cleared is out of reach', () => {
    // Seven spaces of water is the longest hit there is, so `widest` carries it in a dry calm and nowhere else.
    expect(readyHole(widest())).toEqual({ ok: false, reason: WEATHER_CARRY });
    const uphill = () => banked(widest(), 1, [0, 9]);
    const hole = defined(draftToHole(uphill()), 'widest uphill');
    // A plateau on the far bank: the 6 from the fairway that just reached it now comes down one dot short, in the water.
    expect(resolveShot(hole, hole.tee, 0, 7, CALM, false, true)).toMatchObject({ legal: false, reason: 'water' });
    expect(finishableCells(hole).has(teeKey(hole))).toBe(false);
    expect(readyHole(uphill())).toEqual({ ok: false, reason: UNREACHABLE });
  });

  it('plays the same river from a plateau, where every carry is a dot further', () => {
    const hole = playable(banked(river(), 1, [14, GRID_H - 1]));
    expect(whyUnplayable(hole)).toBeNull();
    expect(resolveShot(hole, TEE, 0, 7, CALM, false, true)).toMatchObject({ end: { x: 6, y: 9 }, holed: true, elev: { climb: -1, shift: 1 } });
    expect(resolveShot(hole, TEE, 0, 6, CALM, false, true)).toMatchObject({ end: { x: 6, y: 10 }, elev: { climb: -1, shift: 1 } });
    expect(diceExpectedFromTee(hole)).toBeLessThan(hole.par + 1);
  });
});

describe('shot reachability', () => {
  it('is exactly what the solver values finitely, in every weather', () => {
    const hole = playable(river());
    const weathers: { wind: Wind; rain: boolean }[] = [
      { wind: CALM, rain: false },
      { wind: CALM, rain: true },
      { wind: at(EVERY_WIND, 1), rain: false },
      { wind: at(EVERY_WIND, 12), rain: true },
    ];
    for (const { wind, rain } of weathers) {
      const values = diceExpectation(hole, rain, wind);
      const finite = [...values.keys()].filter((i) => Number.isFinite(at(values, i)));
      expect([...finishableCells(hole, wind, rain)].sort((a, b) => a - b)).toEqual(finite);
    }
  });
});
