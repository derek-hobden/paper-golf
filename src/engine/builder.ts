/**
 * A hole a player draws: paint, one tee, one pin, then a compact `#h=` link.
 * Pure. The screen calls these and draws the result; nothing here touches the DOM.
 */
import { GRID_H, GRID_W, validateHole } from './generator';
import { gridAt } from './grid';
import { inBounds, isLandable, samePos } from './rules';
import { puttComponent } from './solver';
import { type Cell, type Dir, type Hole, type P, type Terrain } from './types';

export type Par = 3 | 4 | 5;

/** What the pencil is set to. Erase is rough with the slope cleared. */
export type Tool = Terrain | 'slope' | 'tee' | 'pin' | 'erase';

export interface Draft {
  cells: Cell[];
  tee: P | null;
  cup: P | null;
  par: Par;
}

/** Shown when a `#h=` link does not decode. */
export const BROKEN_LINK = 'That hole link is broken';

export const PLACE_BOTH = 'Place a tee and a pin.';
export const PLACE_TEE = 'Place a tee.';
export const PLACE_PIN = 'Place a pin.';
export const TEE_LIE = 'The tee has to sit on grass or sand.';
export const PIN_LIE = 'The pin has to sit on grass or sand.';
export const SAME_SQUARE = 'The tee and the pin have to be different squares.';
export const UNREACHABLE = "The pin can't be reached from the tee — join them up with ground a ball can cross.";
export const UNFINISHABLE = "This hole can't be finished — try a shorter carry, or less water.";
export const SLOPE_LIE = 'A slope needs grass or sand.';
export const LEAVE_WARN = 'Tap Back again to leave — the hole is not saved.';

/** The step shown while the hole is drawn: what it still needs, or that it is ready. */
export const STEP_BOTH = 'Place a tee and a pin';
export const STEP_TEE = 'Place a tee';
export const STEP_PIN = 'Place a pin';
export const STEP_TEE_LIE = 'Move the tee onto grass or sand';
export const STEP_PIN_LIE = 'Move the pin onto grass or sand';
export const STEP_SAME = 'Put the tee and the pin on different squares';
export const STEP_READY = 'Ready — tap Play this hole';

const TERRAINS = ['rough', 'fairway', 'sand', 'water', 'tree'] as const;
const SLOPE_CYCLE: readonly Dir[] = [0, 1, 2, 3, 4, 5, 6, 7];
/** A tee or pin that has not been placed yet: off the page, so the board draws neither. */
const UNPLACED: P = { x: 10_000, y: 10_000 };
const VERSION = 1;
const HEADER = 6;
const CELLS = GRID_W * GRID_H;
/** Any finite expected score. The par windows belong to generated holes, not a hole the player drew. */
const FINISHABLE: readonly [number, number] = [0, 1e9];

export function isPar(n: number): n is Par {
  return n === 3 || n === 4 || n === 5;
}

function isTerrainIndex(n: number): n is 0 | 1 | 2 | 3 | 4 {
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4;
}

function isDir(n: number): n is Dir {
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6 || n === 7;
}

function onGrid(p: P): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < GRID_W && p.y < GRID_H;
}

function pointsEqual(a: P | null, b: P | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

/** An empty page: rough, no tee, no pin, par 4. */
export function blankDraft(): Draft {
  return {
    par: 4,
    tee: null,
    cup: null,
    cells: Array.from({ length: CELLS }, (): Cell => ({ t: 'rough' })),
  };
}

export function cloneDraft(draft: Draft): Draft {
  return {
    par: draft.par,
    tee: draft.tee === null ? null : { ...draft.tee },
    cup: draft.cup === null ? null : { ...draft.cup },
    cells: draft.cells.map((c) => ({ ...c })),
  };
}

export function draftsEqual(a: Draft, b: Draft): boolean {
  if (a.par !== b.par || a.cells.length !== b.cells.length) return false;
  if (!pointsEqual(a.tee, b.tee) || !pointsEqual(a.cup, b.cup)) return false;
  return a.cells.every((c, i) => {
    const o = b.cells[i];
    return o !== undefined && c.t === o.t && c.slope === o.slope && c.v === o.v;
  });
}

export function setPar(draft: Draft, par: Par): Draft {
  return { ...draft, par };
}

/** Wipe the drawing. The chosen par stays. */
export function clearDraft(draft: Draft): Draft {
  return { ...blankDraft(), par: draft.par };
}

/** A slope cycles through its eight arrows, so it applies once per gesture; every other tool follows the drag. */
export function toolRepeats(tool: Tool): boolean {
  return tool !== 'slope';
}

/**
 * The tee and the pin are one square each, so a drag moves the one it put down instead of leaving a trail: each move
 * is applied to the draft the gesture started on, which also puts back a pin the tee only passed over.
 */
export function toolReplaces(tool: Tool): boolean {
  return tool === 'tee' || tool === 'pin';
}

function nextSlope(slope: Dir | undefined): Dir | undefined {
  if (slope === undefined) return 0;
  return SLOPE_CYCLE[SLOPE_CYCLE.indexOf(slope) + 1];
}

/** Paint `tool` onto one cell. Out of range, or a no-op, returns `draft` unchanged. */
export function applyTool(draft: Draft, x: number, y: number, tool: Tool): Draft {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !onGrid({ x, y })) return draft;
  if (tool === 'tee') {
    const cup = draft.cup !== null && draft.cup.x === x && draft.cup.y === y ? null : draft.cup;
    return { ...draft, tee: { x, y }, cup };
  }
  if (tool === 'pin') {
    const tee = draft.tee !== null && draft.tee.x === x && draft.tee.y === y ? null : draft.tee;
    return { ...draft, cup: { x, y }, tee };
  }
  const current = gridAt(draft.cells, GRID_W, x, y);
  let cell: Cell;
  if (tool === 'erase') {
    cell = { t: 'rough' };
  } else if (tool === 'slope') {
    if (current.t === 'water' || current.t === 'tree') return draft;
    cell = { t: current.t };
    if (current.v !== undefined) cell.v = current.v;
    const slope = nextSlope(current.slope);
    if (slope !== undefined) cell.slope = slope;
  } else {
    cell = { t: tool };
    if (tool !== 'water' && tool !== 'tree' && current.slope !== undefined) cell.slope = current.slope;
    if (tool === 'tree') cell.v = (x + y) % 2;
  }
  const cells = draft.cells.slice();
  cells[y * GRID_W + x] = cell;
  return { ...draft, cells };
}

/** The board's hole for a draft. A missing tee or pin sits off the page. */
export function previewHole(draft: Draft): Hole {
  return {
    course: 0,
    number: 1,
    seed: 1,
    w: GRID_W,
    h: GRID_H,
    par: draft.par,
    tee: draft.tee === null ? UNPLACED : { ...draft.tee },
    cup: draft.cup === null ? UNPLACED : { ...draft.cup },
    cells: draft.cells.map((c) => ({ ...c })),
  };
}

/** A playable hole, or null until both the tee and the pin are down. */
export function draftToHole(draft: Draft): Hole | null {
  if (draft.tee === null || draft.cup === null || draft.cells.length !== CELLS) return null;
  const hole = previewHole(draft);
  return inBounds(hole, hole.tee) && inBounds(hole, hole.cup) ? hole : null;
}

export function holeToDraft(hole: Hole): Draft | null {
  if (hole.w !== GRID_W || hole.h !== GRID_H || hole.cells.length !== CELLS || !isPar(hole.par)) return null;
  if (!onGrid(hole.tee) || !onGrid(hole.cup)) return null;
  return {
    par: hole.par,
    tee: { ...hole.tee },
    cup: { ...hole.cup },
    cells: hole.cells.map((c) => {
      const cell: Cell = { t: c.t };
      if (c.slope !== undefined) cell.slope = c.slope;
      if (c.v !== undefined) cell.v = c.v;
      return cell;
    }),
  };
}

/**
 * The one line that tells the player what the hole still needs, or that it is ready. Cheap enough to run on every
 * painted cell: it never asks the solver, so a hole it calls ready can still turn out unreachable at `readyHole`.
 */
export function builderStep(draft: Draft): string {
  if (draft.tee === null && draft.cup === null) return STEP_BOTH;
  if (draft.tee === null) return STEP_TEE;
  if (draft.cup === null) return STEP_PIN;
  const hole = previewHole(draft);
  if (!isLandable(hole, hole.tee)) return STEP_TEE_LIE;
  if (!isLandable(hole, hole.cup)) return STEP_PIN_LIE;
  if (samePos(hole.tee, hole.cup)) return STEP_SAME;
  return STEP_READY;
}

/** Why `tool` on this square would change nothing, or '' when there is nothing worth saying. */
export function toolRefusal(draft: Draft, x: number, y: number, tool: Tool): string {
  if (tool !== 'slope' || !Number.isInteger(x) || !Number.isInteger(y) || !onGrid({ x, y })) return '';
  const t = gridAt(draft.cells, GRID_W, x, y).t;
  return t === 'water' || t === 'tree' ? SLOPE_LIE : '';
}

/**
 * Why `hole` cannot be played, or null when it can. Uses `validateHole` and the solver:
 * the tee and the pin have to be landable and different, the pin has to be reachable by
 * putting from the tee, and the solver has to find a finite number of strokes.
 */
export function whyUnplayable(hole: Hole): string | null {
  if (!isLandable(hole, hole.tee)) return TEE_LIE;
  if (!isLandable(hole, hole.cup)) return PIN_LIE;
  if (samePos(hole.tee, hole.cup)) return SAME_SQUARE;
  if (!puttComponent(hole, hole.tee).has(hole.cup.y * hole.w + hole.cup.x)) return UNREACHABLE;
  const verdict = validateHole(hole, FINISHABLE);
  if (!verdict.ok || !Number.isFinite(verdict.diceExpected)) return UNFINISHABLE;
  return null;
}

/** The hole to play, or the one sentence that keeps the player on the builder. */
export function readyHole(draft: Draft): { ok: true; hole: Hole } | { ok: false; reason: string } {
  if (draft.tee === null && draft.cup === null) return { ok: false, reason: PLACE_BOTH };
  if (draft.tee === null) return { ok: false, reason: PLACE_TEE };
  if (draft.cup === null) return { ok: false, reason: PLACE_PIN };
  const hole = draftToHole(draft);
  if (hole === null) return { ok: false, reason: PLACE_BOTH };
  const reason = whyUnplayable(hole);
  if (reason !== null) return { ok: false, reason };
  return { ok: true, hole };
}

/**
 * The cell under a pointer, or null when it misses the board.
 * `rect` is the board's box in client pixels; the grid is `GRID_W` by `GRID_H`.
 */
export function cellFromClient(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): P | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.floor(((clientX - rect.left) / rect.width) * GRID_W);
  const y = Math.floor(((clientY - rect.top) / rect.height) * GRID_H);
  return onGrid({ x, y }) ? { x, y } : null;
}

function packCell(c: Cell): number | null {
  const terrain = TERRAINS.indexOf(c.t);
  if (!isTerrainIndex(terrain)) return null;
  const slope = c.slope === undefined ? 0 : c.slope + 1;
  if (slope < 0 || slope > 8) return null;
  const variant = c.t === 'tree' && c.v === 1 ? 1 : 0;
  return terrain | (slope << 3) | (variant << 7);
}

function unpackCell(b: number): Cell | null {
  if (!Number.isInteger(b) || b < 0 || b > 255) return null;
  const terrainN = b & 7;
  if (!isTerrainIndex(terrainN)) return null;
  const terrain = TERRAINS[terrainN];
  const slopeN = (b >> 3) & 15;
  if (slopeN > 8) return null;
  const variant = (b >> 7) & 1;
  if (variant === 1 && terrain !== 'tree') return null;
  const cell: Cell = { t: terrain };
  if (slopeN > 0) {
    const dir = slopeN - 1;
    if (!isDir(dir)) return null;
    cell.slope = dir;
  }
  if (terrain === 'tree') cell.v = variant;
  return cell;
}

function bytesToToken(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function tokenToBytes(token: string): Uint8Array | null {
  if (token.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(token)) return null;
  const pad = (4 - (token.length % 4)) % 4;
  try {
    const bin = atob(`${token.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat(pad)}`);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * `#h=<token>`. Six header bytes (version, par, tee x/y, pin x/y) then one byte per cell:
 * terrain in bits 0–2, slope (0 = none, 1–8 = N..NW) in bits 3–6, tree variant in bit 7.
 */
export function encodeHole(hole: Hole): string | null {
  if (hole.w !== GRID_W || hole.h !== GRID_H || hole.cells.length !== CELLS || !isPar(hole.par)) return null;
  if (!onGrid(hole.tee) || !onGrid(hole.cup)) return null;
  const bytes = new Uint8Array(HEADER + CELLS);
  bytes[0] = VERSION;
  bytes[1] = hole.par;
  bytes[2] = hole.tee.x;
  bytes[3] = hole.tee.y;
  bytes[4] = hole.cup.x;
  bytes[5] = hole.cup.y;
  for (let i = 0; i < CELLS; i += 1) {
    const c = hole.cells[i];
    if (c === undefined) return null;
    const packed = packCell(c);
    if (packed === null) return null;
    bytes[HEADER + i] = packed;
  }
  return bytesToToken(bytes);
}

/** The hole in `token`, or null when any byte is the wrong shape. Nothing is repaired. */
export function decodeHole(token: string): Hole | null {
  const bytes = tokenToBytes(token);
  if (bytes === null || bytes.length !== HEADER + CELLS) return null;
  const version = bytes[0];
  const par = bytes[1];
  const teeX = bytes[2];
  const teeY = bytes[3];
  const cupX = bytes[4];
  const cupY = bytes[5];
  if (version !== VERSION || par === undefined || !isPar(par)) return null;
  if (teeX === undefined || teeY === undefined || cupX === undefined || cupY === undefined) return null;
  const tee = { x: teeX, y: teeY };
  const cup = { x: cupX, y: cupY };
  if (!onGrid(tee) || !onGrid(cup)) return null;
  const cells: Cell[] = [];
  for (let i = 0; i < CELLS; i += 1) {
    const b = bytes[HEADER + i];
    if (b === undefined) return null;
    const cell = unpackCell(b);
    if (cell === null) return null;
    cells.push(cell);
  }
  return { course: 0, number: 1, seed: 1, w: GRID_W, h: GRID_H, par, cells, tee, cup };
}

/**
 * A `#h=` (or `h=`) link. Null when the hash is not a hole link at all;
 * `{ ok: false }` when it is one and does not decode.
 */
export function readHoleHash(hash: string): { ok: true; hole: Hole } | { ok: false } | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!body.startsWith('h=')) return null;
  const token = body.slice(2);
  if (token.length === 0 || token.includes('&')) return { ok: false };
  const hole = decodeHole(token);
  return hole === null ? { ok: false } : { ok: true, hole };
}
