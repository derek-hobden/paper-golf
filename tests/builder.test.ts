import { describe, expect, it } from 'vitest';
import {
  BROKEN_LINK,
  PIN_LIE,
  PIN_WALLED,
  PLACE_BOTH,
  PLACE_PIN,
  PLACE_TEE,
  SAME_SQUARE,
  SLOPE_LIE,
  STEP_READY,
  TEE_LIE,
  applyTool,
  builderStep,
  toolRefusal,
  blankDraft,
  cellFromClient,
  clearDraft,
  cloneDraft,
  decodeHole,
  draftsEqual,
  encodeHole,
  holeToDraft,
  previewHole,
  readHoleHash,
  readyHole,
  setPar,
  toolReplaces,
  toolRepeats,
  whyUnplayable,
  type Draft,
  type Par,
} from '../src/engine/builder';
import { GRID_H, GRID_W } from '../src/engine/generator';
import { gridAt } from '../src/engine/grid';
import type { Cell, Dir, P } from '../src/engine/types';
import { windForHole } from '../src/engine/wind';
import {
  builtHole,
  currentBall,
  currentHole,
  holesInRound,
  holeWind,
  isPersisted,
  newBuiltRound,
  newGame,
  nextHole,
  recordsCourseBest,
  toPar,
} from '../src/game/game';
import { at, defined, holeOutWithPutt } from './helpers';

function cell(draft: Draft, x: number, y: number): Cell {
  return gridAt(draft.cells, GRID_W, x, y);
}

/** The bytes a `#h=` token carries. */
function bytesOf(token: string): Uint8Array {
  return Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
}

/** The format version a `#h=` token opens with. */
function version(token: string): number {
  return at(bytesOf(token), 0);
}

/** A draft filled by `fill`, with a tee and a pin. */
function drawn(fill: (x: number, y: number) => Cell, tee: P, cup: P, par: Par = 4): Draft {
  const cells: Cell[] = [];
  for (let y = 0; y < GRID_H; y += 1) for (let x = 0; x < GRID_W; x += 1) cells.push(fill(x, y));
  return { cells, tee, cup, par };
}

function fairwayHole(): Draft {
  return drawn(
    () => ({ t: 'fairway' }),
    { x: 6, y: 16 },
    { x: 6, y: 12 },
    5,
  );
}

describe('course builder', () => {
  it('starts from a blank page of rough, par 4, with no tee and no pin', () => {
    const draft = blankDraft();
    expect(draft.par).toBe(4);
    expect(draft.tee).toBeNull();
    expect(draft.cup).toBeNull();
    expect(draft.cells).toHaveLength(GRID_W * GRID_H);
    expect(draft.cells.every((c) => c.t === 'rough' && c.slope === undefined)).toBe(true);
    expect(readyHole(draft)).toEqual({ ok: false, reason: PLACE_BOTH });
  });

  it('paints terrain, keeps a slope on grass, and clears it on water or trees', () => {
    let draft = applyTool(blankDraft(), 2, 3, 'sand');
    expect(cell(draft, 2, 3).t).toBe('sand');
    draft = applyTool(draft, 2, 3, 'slope');
    expect(cell(draft, 2, 3)).toEqual({ t: 'sand', slope: 0 });
    draft = applyTool(draft, 2, 3, 'fairway');
    expect(cell(draft, 2, 3)).toEqual({ t: 'fairway', slope: 0 });
    draft = applyTool(draft, 2, 3, 'water');
    expect(cell(draft, 2, 3)).toEqual({ t: 'water' });
    expect(applyTool(draft, 2, 3, 'slope')).toBe(draft);
    draft = applyTool(draft, 4, 5, 'tree');
    expect(cell(draft, 4, 5)).toEqual({ t: 'tree', v: 1 });
    expect(applyTool(draft, 4, 5, 'slope')).toBe(draft);
    draft = applyTool(draft, 4, 4, 'tree');
    expect(cell(draft, 4, 4)).toEqual({ t: 'tree', v: 0 });
    expect(applyTool(draft, -1, 0, 'rough')).toBe(draft);
  });

  it('cycles a slope through the eight arrows and then off', () => {
    let draft = blankDraft();
    const seen: (Dir | undefined)[] = [];
    for (let n = 0; n < 9; n += 1) {
      draft = applyTool(draft, 1, 1, 'slope');
      seen.push(cell(draft, 1, 1).slope);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, undefined]);
    expect(toolRepeats('slope')).toBe(false);
    expect(toolRepeats('fairway')).toBe(true);
    expect(toolRepeats('erase')).toBe(true);
    // The tee and the pin follow a drag, but each move replaces the last one rather than leaving a trail.
    expect(toolRepeats('tee')).toBe(true);
    expect(toolRepeats('pin')).toBe(true);
    expect(toolReplaces('tee')).toBe(true);
    expect(toolReplaces('pin')).toBe(true);
    expect(toolReplaces('fairway')).toBe(false);
    expect(toolReplaces('slope')).toBe(false);
  });

  it('erases back to rough, and places one tee and one pin', () => {
    let draft = applyTool(applyTool(blankDraft(), 3, 3, 'slope'), 3, 3, 'erase');
    expect(cell(draft, 3, 3)).toEqual({ t: 'rough' });
    draft = applyTool(applyTool(draft, 1, 2, 'tee'), 4, 5, 'tee');
    expect(draft.tee).toEqual({ x: 4, y: 5 });
    draft = applyTool(draft, 6, 7, 'pin');
    expect(draft.cup).toEqual({ x: 6, y: 7 });
    expect(draft.tee).toEqual({ x: 4, y: 5 });
    draft = applyTool(draft, 6, 7, 'tee');
    expect(draft.tee).toEqual({ x: 6, y: 7 });
    expect(draft.cup).toBeNull();
    draft = applyTool(draft, 6, 7, 'pin');
    expect(draft.cup).toEqual({ x: 6, y: 7 });
    expect(draft.tee).toBeNull();
    expect(readyHole(draft)).toEqual({ ok: false, reason: PLACE_TEE });
    expect(readyHole(applyTool(blankDraft(), 1, 1, 'tee'))).toEqual({ ok: false, reason: PLACE_PIN });
  });

  it('clears the drawing and keeps the par', () => {
    const draft = clearDraft(setPar(applyTool(blankDraft(), 1, 1, 'tee'), 3));
    expect(draft.par).toBe(3);
    expect(draft.tee).toBeNull();
    expect(draftsEqual(draft, setPar(blankDraft(), 3))).toBe(true);
    expect(draftsEqual(cloneDraft(draft), draft)).toBe(true);
  });

  it('says what the hole still needs, without running the solver', () => {
    expect(builderStep(blankDraft())).toBe('Place a tee and a pin');
    expect(builderStep(applyTool(blankDraft(), 1, 1, 'tee'))).toBe('Place a pin');
    expect(builderStep(applyTool(blankDraft(), 1, 1, 'pin'))).toBe('Place a tee');

    const tee = { x: 6, y: 16 };
    const cup = { x: 6, y: 12 };
    expect(builderStep(fairwayHole())).toBe(STEP_READY);
    expect(builderStep(drawn(() => ({ t: 'fairway' }), tee, tee))).toBe('Put the tee and the pin on different squares');

    const wetTee = drawn(() => ({ t: 'fairway' }), tee, cup);
    wetTee.cells[tee.y * GRID_W + tee.x] = { t: 'water' };
    expect(builderStep(wetTee)).toBe('Move the tee onto grass or sand');
    const treePin = drawn(() => ({ t: 'fairway' }), tee, cup);
    treePin.cells[cup.y * GRID_W + cup.x] = { t: 'tree' };
    expect(builderStep(treePin)).toBe('Move the pin onto grass or sand');
    // Ready says nothing about reachability: that is the solver's answer, and it waits for Play or Share.
    const walled = drawn((x, y) => (Math.max(Math.abs(x - cup.x), Math.abs(y - cup.y)) === 1 ? { t: 'tree' } : { t: 'rough' }), tee, cup);
    expect(builderStep(walled)).toBe(STEP_READY);
    expect(readyHole(walled)).toEqual({ ok: false, reason: PIN_WALLED });
  });

  it('explains a slope the ground refuses, and stays quiet otherwise', () => {
    let draft = applyTool(blankDraft(), 2, 3, 'water');
    draft = applyTool(draft, 3, 3, 'tree');
    expect(toolRefusal(draft, 2, 3, 'slope')).toBe(SLOPE_LIE);
    expect(toolRefusal(draft, 3, 3, 'slope')).toBe(SLOPE_LIE);
    expect(SLOPE_LIE).toBe('A slope needs grass or sand.');
    // Grass, sand, another tool, or off the page: nothing to say.
    expect(toolRefusal(draft, 4, 3, 'slope')).toBe('');
    expect(toolRefusal(applyTool(draft, 4, 3, 'sand'), 4, 3, 'slope')).toBe('');
    expect(toolRefusal(draft, 2, 3, 'fairway')).toBe('');
    expect(toolRefusal(draft, 2, 3, 'erase')).toBe('');
    expect(toolRefusal(draft, -1, 3, 'slope')).toBe('');
    expect(toolRefusal(draft, 0, GRID_H, 'slope')).toBe('');
  });

  it('reads the cell under a pointer', () => {
    const rect = { left: 10, top: 20, width: 130, height: 200 };
    expect(cellFromClient(rect, 10, 20)).toEqual({ x: 0, y: 0 });
    expect(cellFromClient(rect, 139, 219)).toEqual({ x: 12, y: 19 });
    expect(cellFromClient(rect, 9, 20)).toBeNull();
    expect(cellFromClient(rect, 140, 20)).toBeNull();
    expect(cellFromClient({ left: 0, top: 0, width: 0, height: 10 }, 0, 0)).toBeNull();
  });

  it('round-trips a drawn hole through the link, including every terrain and both tree shapes', () => {
    let draft = setPar(blankDraft(), 3);
    draft = applyTool(draft, 0, 0, 'fairway');
    draft = applyTool(draft, 1, 0, 'sand');
    draft = applyTool(draft, 2, 0, 'water');
    draft = applyTool(draft, 3, 0, 'tree');
    draft = applyTool(draft, 3, 1, 'tree');
    draft = applyTool(draft, 4, 0, 'slope');
    draft = applyTool(draft, 4, 0, 'slope');
    draft = applyTool(draft, 1, 18, 'tee');
    draft = applyTool(draft, 11, 2, 'pin');
    const hole = draft.tee && draft.cup ? { ...previewHole(draft), tee: draft.tee, cup: draft.cup } : null;
    expect(hole).not.toBeNull();
    if (!hole) return;
    const token = encodeHole(hole);
    expect(token).toEqual(expect.any(String));
    if (token === null) return;
    expect(token).not.toMatch(/[+/=]/u);
    const back = decodeHole(token);
    expect(back).not.toBeNull();
    if (!back) return;
    expect(back).toMatchObject({ course: 0, number: 1, seed: 1, w: GRID_W, h: GRID_H, par: 3, tee: { x: 1, y: 18 }, cup: { x: 11, y: 2 } });
    expect(back.cells).toEqual(hole.cells);
    expect(holeToDraft(back)).toEqual({ ...draft, cells: hole.cells });
    const link = readHoleHash(`#h=${token}`);
    expect(link).toEqual({ ok: true, hole: back });
  });

  it('rejects a broken link instead of repairing it', () => {
    const hole = previewHole(fairwayHole());
    const token = encodeHole(hole);
    expect(token).toEqual(expect.any(String));
    if (token === null) return;
    const bytes = Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    const corrupt = (index: number, value: number) => {
      const copy = bytes.slice();
      copy[index] = value;
      let bin = '';
      for (const b of copy) bin += String.fromCharCode(b);
      return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    };
    expect(decodeHole('')).toBeNull();
    expect(decodeHole('@@@')).toBeNull();
    expect(decodeHole(token.slice(0, 12))).toBeNull();
    expect(decodeHole(corrupt(0, 2))).toBeNull();
    expect(decodeHole(corrupt(1, 9))).toBeNull();
    expect(decodeHole(corrupt(2, 40))).toBeNull();
    expect(decodeHole(corrupt(6, 0b111))).toBeNull();
    expect(decodeHole(corrupt(6, 0b1001_0000))).toBeNull();
    expect(decodeHole(corrupt(6, 0b1000_0001))).toBeNull();
    expect(encodeHole({ ...hole, w: 2, cells: [] })).toBeNull();
    expect(readHoleHash('')).toBeNull();
    expect(readHoleHash('#play')).toBeNull();
    expect(readHoleHash('#h=')).toEqual({ ok: false });
    expect(readHoleHash('#h=not-a-hole')).toEqual({ ok: false });
    expect(readHoleHash(`h=${corrupt(1, 2)}`)).toEqual({ ok: false });
    expect(BROKEN_LINK).toBe('That hole link is broken');
  });

  it('refuses a pin nothing can reach, and plays a fairway that can be finished', () => {
    const cup = { x: 6, y: 4 };
    const tee = { x: 6, y: 16 };
    // Trees turn away every hit that is not from the fairway, and no putt crosses them: this pin is walled in.
    const walled = drawn((x, y) => {
      const near = Math.max(Math.abs(x - cup.x), Math.abs(y - cup.y));
      if (x === cup.x && y === cup.y) return { t: 'rough' };
      if (near === 1) return { t: 'tree' };
      return { t: 'rough' };
    }, tee, cup);
    expect(readyHole(walled)).toEqual({ ok: false, reason: PIN_WALLED });
    // A pin on an island in the water is not walled in: a hit flies over water and drops in (`tests/carry.test.ts`).
    const island = drawn((x, y) => {
      const near = Math.max(Math.abs(x - cup.x), Math.abs(y - cup.y));
      if (x === cup.x && y === cup.y) return { t: 'fairway' };
      if (near === 1) return { t: 'water' };
      return { t: 'rough' };
    }, tee, cup);
    expect(readyHole(island).ok).toBe(true);

    const waterTee = drawn(() => ({ t: 'fairway' }), tee, cup);
    waterTee.cells[tee.y * GRID_W + tee.x] = { t: 'water' };
    expect(readyHole(waterTee)).toEqual({ ok: false, reason: TEE_LIE });
    const treePin = drawn(() => ({ t: 'fairway' }), tee, cup);
    treePin.cells[cup.y * GRID_W + cup.x] = { t: 'tree' };
    expect(readyHole(treePin)).toEqual({ ok: false, reason: PIN_LIE });
    expect(readyHole(drawn(() => ({ t: 'fairway' }), tee, tee))).toEqual({ ok: false, reason: SAME_SQUARE });

    const ready = readyHole(fairwayHole());
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(whyUnplayable(ready.hole)).toBeNull();
    const preview = previewHole(blankDraft());
    expect(preview.tee).toEqual({ x: 10_000, y: 10_000 });
    expect(preview.cup).toEqual({ x: 10_000, y: 10_000 });
  });

  it('plays the built hole as one round, with the usual wind, and does not record a best', () => {
    const ready = readyHole(fairwayHole());
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    const round = newBuiltRound(ready.hole, ['Ada'], 1);
    expect(isPersisted(round)).toBe(false);
    expect(recordsCourseBest(round)).toBe(false);
    expect(holesInRound(round)).toBe(1);
    expect(builtHole(round)?.par).toBe(5);
    expect(currentHole(round).tee).toEqual(ready.hole.tee);
    expect(currentHole(round).cells).toEqual(ready.hole.cells);
    expect(currentHole(round)).not.toBe(ready.hole);
    expect(currentBall(round).pos).toEqual(ready.hole.tee);
    expect(holeWind(round)).toEqual(windForHole(1, 0, 0));
    ready.hole.cells[0] = { t: 'water' };
    expect(at(currentHole(round).cells, 0).t).toBe('fairway');
    holeOutWithPutt(round);
    expect(round.holeDone).toBe(true);
    expect(toPar(at(round.players, 0), round)).toBe(1 - 5);
    nextHole(round);
    expect(round.finished).toBe(true);
    expect(round.holeIndex).toBe(0);

    const ordinary = newGame(0, ['Bea']);
    expect(isPersisted(ordinary)).toBe(true);
    expect(recordsCourseBest(ordinary)).toBe(true);
    expect(holesInRound(ordinary)).toBe(18);
    expect(builtHole(ordinary)).toBeUndefined();
    expect(toPar(at(ordinary.players, 0), ordinary)).toBe(0);
  });
});

describe('the Height tool', () => {
  it('cycles one square level → raised → sunken → level, whatever is painted there', () => {
    for (const t of ['rough', 'fairway', 'sand', 'water', 'tree'] as const) {
      let draft = applyTool(blankDraft(), 3, 4, t);
      expect(cell(draft, 3, 4).e).toBeUndefined();
      draft = applyTool(draft, 3, 4, 'height');
      expect(cell(draft, 3, 4)).toMatchObject({ t, e: 1 });
      draft = applyTool(draft, 3, 4, 'height');
      expect(cell(draft, 3, 4)).toMatchObject({ t, e: -1 });
      draft = applyTool(draft, 3, 4, 'height');
      expect(cell(draft, 3, 4).e).toBeUndefined();
      expect(cell(draft, 3, 4).t).toBe(t);
    }
  });

  it('applies once per gesture, like a slope, and never says no', () => {
    expect(toolRepeats('height')).toBe(false);
    expect(toolReplaces('height')).toBe(false);
    // Nothing refuses a height: every terrain sits at every level, water and trees included.
    const drawn = applyTool(applyTool(blankDraft(), 2, 2, 'water'), 2, 3, 'tree');
    expect(toolRefusal(drawn, 2, 2, 'height')).toBe('');
    expect(toolRefusal(drawn, 2, 3, 'height')).toBe('');
    expect(toolRefusal(drawn, 2, 2, 'slope')).toBe(SLOPE_LIE);
    // Off the page it changes nothing at all.
    expect(applyTool(drawn, -1, 0, 'height')).toBe(drawn);
    expect(applyTool(drawn, 0, GRID_H, 'height')).toBe(drawn);
  });

  it('keeps the height when terrain or a slope is painted over it, and Erase levels it', () => {
    let draft = applyTool(applyTool(blankDraft(), 5, 6, 'height'), 5, 6, 'fairway');
    expect(cell(draft, 5, 6)).toMatchObject({ t: 'fairway', e: 1 });
    draft = applyTool(draft, 5, 6, 'slope');
    expect(cell(draft, 5, 6)).toMatchObject({ t: 'fairway', e: 1, slope: 0 });
    draft = applyTool(draft, 5, 6, 'erase');
    expect(cell(draft, 5, 6)).toEqual({ t: 'rough' });
  });

  it('is a change of its own: Undo steps back over it and the drawing is no longer the same', () => {
    const before = blankDraft();
    const after = applyTool(before, 7, 7, 'height');
    expect(draftsEqual(before, after)).toBe(false);
    expect(draftsEqual(after, cloneDraft(after))).toBe(true);
    expect(draftsEqual(after, applyTool(after, 7, 7, 'height'))).toBe(false);
    expect(draftsEqual(clearDraft(after), before)).toBe(true);
  });
});

describe('a share link with heights', () => {
  /** A playable hole with a plateau, a dip and a drop between them. */
  function hilly(): Draft {
    let draft = drawn(() => ({ t: 'fairway' }), { x: 2, y: 17 }, { x: 6, y: 4 });
    for (let x = 1; x <= 5; x += 1) draft = applyTool(draft, x, 10, 'height');
    for (let x = 6; x <= 9; x += 1) {
      draft = applyTool(draft, x, 10, 'height');
      draft = applyTool(draft, x, 10, 'height');
    }
    return draft;
  }

  it('carries every height through the link unchanged', () => {
    const hole = previewHole(hilly());
    expect(hole.cells.filter((c) => c.e === 1)).toHaveLength(5);
    expect(hole.cells.filter((c) => c.e === -1)).toHaveLength(4);
    const token = defined(encodeHole(hole), 'token');
    expect(token).not.toMatch(/[+/=]/u);
    const back = defined(decodeHole(token), 'decoded hole');
    expect(back.cells).toEqual(hole.cells);
    expect(holeToDraft(back)).toEqual(holeToDraft(hole));
    expect(readHoleHash(`#h=${token}`)).toEqual({ ok: true, hole: back });
  });

  it('is version 2, and a level hole is still the version 1 link it always was', () => {
    const flat = previewHole(drawn(() => ({ t: 'fairway' }), { x: 2, y: 17 }, { x: 6, y: 4 }));
    const flatToken = defined(encodeHole(flat), 'flat token');
    const hillyToken = defined(encodeHole(previewHole(hilly())), 'hilly token');
    expect(version(flatToken)).toBe(1);
    expect(version(hillyToken)).toBe(2);
    // The heights ride in a block of their own: two bits per cell, after the 6 header bytes and the 260 cell bytes.
    expect(bytesOf(flatToken)).toHaveLength(6 + GRID_W * GRID_H);
    expect(bytesOf(hillyToken)).toHaveLength(6 + GRID_W * GRID_H + Math.ceil((GRID_W * GRID_H) / 4));
    // Every link shared before elevation reads back as the level hole it was.
    expect(defined(decodeHole(flatToken), 'flat hole').cells.every((c) => c.e === undefined)).toBe(true);
  });

  it('refuses a height block that is the wrong length or carries a code that is not a height', () => {
    const token = defined(encodeHole(previewHole(hilly())), 'token');
    const bytes = bytesOf(token);
    const retoken = (b: Uint8Array) => {
      let bin = '';
      for (const x of b) bin += String.fromCharCode(x);
      return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    };
    // Version 2 without its height block, and version 1 with one.
    expect(decodeHole(retoken(bytes.slice(0, 6 + GRID_W * GRID_H)))).toBeNull();
    const asFlat = bytes.slice();
    asFlat[0] = 1;
    expect(decodeHole(retoken(asFlat))).toBeNull();
    // Code 3 is not a height.
    const bad = bytes.slice();
    bad[6 + GRID_W * GRID_H] = 0b1111_1111;
    expect(decodeHole(retoken(bad))).toBeNull();
    // A version this release does not know.
    const future = bytes.slice();
    future[0] = 3;
    expect(decodeHole(retoken(future))).toBeNull();
  });
});
