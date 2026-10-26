import { itemAt } from './assert';
import { gridAt } from './grid';
import { builtinHoleId } from './holeid';
import { chance, mulberry32, pick, randInt, randRange, type Rng } from './rng';
import { isLandable, samePos } from './rules';
import { diceExpectedFromTee, puttComponent } from './solver';
import { DIRS, type Cell, type Dir, type Hole, type P, type Terrain } from './types';

export const GRID_W = 13;
export const GRID_H = 20;

export interface CourseDef {
  name: string;
  blurb: string;
  /** 0 (gentle) .. 1 (brutal). */
  difficulty: number;
}

export const COURSES: readonly CourseDef[] = [
  { name: 'Meadow Links', blurb: 'Wide fairways, a gentle start.', difficulty: 0.1 },
  { name: 'Pine Hollow', blurb: 'Tight lines through the woods.', difficulty: 0.3 },
  { name: 'Dune Ridge', blurb: 'Sand everywhere. Bring a rake.', difficulty: 0.5 },
  { name: 'Lakeside', blurb: 'Carry the water or go around.', difficulty: 0.7 },
  { name: 'Thunder Peaks', blurb: 'Slopes, trees, ponds. Good luck.', difficulty: 0.9 },
];

export interface HoleStats {
  diceExpected: number;
  attempts: number;
}

const holeSeed = (course: number, number: number, attempt: number) =>
  (Math.imul(course + 1, 0x9e3779b1) ^ Math.imul(number + 1, 0x85ebca6b) ^ Math.imul(attempt + 1, 0xc2b2ae35)) >>> 0;

interface Draft {
  w: number;
  h: number;
  cells: Cell[];
  tee: P;
  cup: P;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * How a hole is laid out: where the tee and cup go (row ranges), how many doglegs, how many fairway landing areas,
 * and a multiplier on hazard counts. Each par has its own shape (`PAR_SHAPES`).
 */
export interface HoleShape {
  teeY: readonly [number, number];
  cupY: readonly [number, number];
  nWay: readonly [number, number];
  /** Fairway landing areas. */
  segments: readonly [number, number];
  /** Multiplier on tree clusters, sand traps and slopes. */
  hazards: number;
  /** Chance multiplier for ponds. */
  water: number;
}

function build(seed: number, difficulty: number, shape: HoleShape): Draft {
  const rng: Rng = mulberry32(seed);
  const w = GRID_W;
  const h = GRID_H;
  const cells: Cell[] = Array.from({ length: w * h }, (): Cell => ({ t: 'rough' }));
  const at = (x: number, y: number) => gridAt(cells, w, x, y);
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

  // Occasionally flip the hole so it plays top-to-bottom or sideways-ish via doglegs.
  const tee: P = { x: randInt(rng, 2, w - 3), y: randInt(rng, ...shape.teeY) };
  const cup: P = { x: randInt(rng, 2, w - 3), y: randInt(rng, ...shape.cupY) };
  const nWay = randInt(rng, ...shape.nWay);
  const pts: P[] = [tee];
  for (let i = 1; i <= nWay; i++) {
    const t = i / (nWay + 1);
    const base = tee.x + (cup.x - tee.x) * t;
    const swing = randRange(rng, -5, 5) * (0.5 + difficulty * 0.5);
    pts.push({ x: clamp(Math.round(base + swing), 1, w - 2), y: Math.round(tee.y + (cup.y - tee.y) * t) });
  }
  pts.push(cup);

  // Arc-length sampling along the polyline.
  const segs = pts.slice(1).map((b, i) => {
    const a = itemAt(pts, i, 'waypoint');
    return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  const total = segs.reduce((acc, s) => acc + s.len, 0);
  const sample = (f: number): { x: number; y: number; nx: number; ny: number } => {
    let d = clamp(f, 0, 1) * total;
    for (const [i, { a, b, len }] of segs.entries()) {
      if (d <= len || i === segs.length - 1) {
        const u = len ? clamp(d / len, 0, 1) : 0;
        const dx = (b.x - a.x) / (len || 1);
        const dy = (b.y - a.y) / (len || 1);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, nx: -dy, ny: dx };
      }
      d -= len;
    }
    return { x: cup.x, y: cup.y, nx: 1, ny: 0 };
  };

  const isProtected = (x: number, y: number) =>
    (Math.abs(x - tee.x) <= 1 && Math.abs(y - tee.y) <= 1) || (Math.abs(x - cup.x) <= 1 && Math.abs(y - cup.y) <= 1);

  const disc = (cx: number, cy: number, r: number, paint: (c: Cell, x: number, y: number) => void) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (inb(x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.15) paint(at(x, y), x, y);
  };

  const blob = (cx: number, cy: number, size: number, paint: (c: Cell, x: number, y: number) => void) => {
    // Random-walk blob of roughly `size` cells.
    let x = Math.round(cx);
    let y = Math.round(cy);
    const done = new Set<number>();
    let guard = 0;
    while (done.size < size && guard++ < size * 8) {
      if (inb(x, y) && !done.has(y * w + x)) {
        done.add(y * w + x);
        paint(at(x, y), x, y);
      }
      const d = pick(rng, DIRS);
      x = clamp(x + d.x, 0, w - 1);
      y = clamp(y + d.y, 0, h - 1);
      if (chance(rng, 0.25)) {
        x = Math.round(cx + randRange(rng, -1.5, 1.5));
        y = Math.round(cy + randRange(rng, -1.5, 1.5));
      }
    }
  };

  const setT = (t: Terrain, over: Terrain[], guardProtected = true) => (c: Cell, x: number, y: number) => {
    if (guardProtected && isProtected(x, y)) return;
    if (over.includes(c.t)) {
      c.t = t;
      if (t === 'tree') c.v = rng() < 0.6 ? 0 : 1;
    }
  };

  // Fairway: tee box, landing areas, green.
  disc(tee.x, tee.y, randRange(rng, 1.1, 1.6), (c) => (c.t = 'fairway'));
  const segments = randInt(rng, ...shape.segments);
  for (let s = 0; s < segments; s++) {
    const f = (s + 1) / (segments + 1) + randRange(rng, -0.07, 0.07);
    const len = randRange(rng, 0.06, 0.16) * (1.2 - difficulty * 0.5);
    for (let g = f - len; g <= f + len; g += 0.03) {
      const p = sample(g);
      disc(p.x + randRange(rng, -0.4, 0.4), p.y, randRange(rng, 0.9, 1.9 - difficulty * 0.5), (c) => (c.t = 'fairway'));
    }
  }
  disc(cup.x, cup.y, randRange(rng, 1.5, 2.4), (c) => (c.t = 'fairway'));

  // Trees: clusters beside (and sometimes across) the line of play.
  const treeClusters = Math.round((randInt(rng, 3, 4) + Math.round(difficulty * 3)) * shape.hazards);
  for (let i = 0; i < treeClusters; i++) {
    const p = sample(randRange(rng, 0.12, 0.88));
    const across = chance(rng, 0.12 + difficulty * 0.3);
    const off = across ? randRange(rng, -0.8, 0.8) : (chance(rng, 0.5) ? 1 : -1) * randRange(rng, 2, 4.5);
    blob(p.x + p.nx * off, p.y + p.ny * off, randInt(rng, 4, 9 + Math.round(difficulty * 5)), setT('tree', ['rough', 'fairway']));
  }
  // A few lone trees out in the rough.
  for (let i = randInt(rng, 2, 6); i > 0; i--) {
    const x = randInt(rng, 0, w - 1);
    const y = randInt(rng, 0, h - 1);
    setT('tree', ['rough'])(at(x, y), x, y);
  }

  // Water.
  const ponds =
    (chance(rng, (0.25 + difficulty * 0.5) * shape.water) ? 1 : 0) + (difficulty > 0.6 && chance(rng, 0.5 * shape.water) ? 1 : 0);
  for (let i = 0; i < ponds; i++) {
    const p = sample(randRange(rng, 0.25, 0.8));
    const across = chance(rng, 0.35 + difficulty * 0.35);
    const off = across ? 0 : (chance(rng, 0.5) ? 1 : -1) * randRange(rng, 2, 3.5);
    const r = randRange(rng, 1.2, 1.6 + difficulty);
    const cx = p.x + p.nx * off;
    const cy = p.y + p.ny * off;
    disc(cx, cy, r, setT('water', ['rough', 'fairway', 'tree']));
    disc(cx + randRange(rng, -1.5, 1.5), cy + randRange(rng, -1, 1), r * 0.8, setT('water', ['rough', 'fairway', 'tree']));
  }

  // Sand traps: around the green and beside landing areas.
  const traps = Math.max(1, Math.round((randInt(rng, 1, 2) + Math.round(difficulty * 2)) * shape.hazards));
  for (let i = 0; i < traps; i++) {
    let cx: number;
    let cy: number;
    if (i === 0 || chance(rng, 0.35)) {
      const ang = randRange(rng, 0, Math.PI * 2);
      const d = randRange(rng, 1.8, 2.8);
      cx = cup.x + Math.cos(ang) * d;
      cy = cup.y + Math.sin(ang) * d;
    } else {
      const p = sample(randRange(rng, 0.25, 0.85));
      const off = (chance(rng, 0.5) ? 1 : -1) * randRange(rng, 0.5, 2.5);
      cx = p.x + p.nx * off;
      cy = p.y + p.ny * off;
    }
    disc(cx, cy, randRange(rng, 0.8, 1.5), setT('sand', ['rough', 'fairway']));
  }

  // Slopes on the grass.
  const slopes = Math.round((randInt(rng, 1, 3) + Math.round(difficulty * 3)) * shape.hazards);
  for (let i = 0, tries = 0; i < slopes && tries < 60; tries++) {
    const p = sample(randRange(rng, 0.1, 1));
    const x = clamp(Math.round(p.x + randRange(rng, -2.5, 2.5)), 0, w - 1);
    const y = clamp(Math.round(p.y + randRange(rng, -2.5, 2.5)), 0, h - 1);
    const c = at(x, y);
    if (isProtectedTight(x, y) || c.slope !== undefined || (c.t !== 'fairway' && c.t !== 'rough')) continue;
    const dir = randInt(rng, 0, 7) as Dir;
    const tx = x + DIRS[dir].x;
    const ty = y + DIRS[dir].y;
    if (!inb(tx, ty)) continue;
    const tc = at(tx, ty);
    if (tc.t === 'water' || tc.t === 'tree' || tc.slope !== undefined || (tx === tee.x && ty === tee.y)) continue;
    c.slope = dir;
    i++;
  }
  function isProtectedTight(x: number, y: number) {
    return (x === tee.x && y === tee.y) || (x === cup.x && y === cup.y);
  }

  at(tee.x, tee.y).t = 'fairway';
  at(cup.x, cup.y).t = 'fairway';

  // Remove islands: any landable cell not 8-connected to the cup becomes a tree.
  const seen = new Uint8Array(w * h);
  const stack: P[] = [cup];
  seen[cup.y * w + cup.x] = 1;
  for (let p = stack.pop(); p; p = stack.pop()) {
    for (const d of DIRS) {
      const x = p.x + d.x;
      const y = p.y + d.y;
      if (!inb(x, y) || seen[y * w + x]) continue;
      const t = at(x, y).t;
      if (t === 'water' || t === 'tree') continue;
      seen[y * w + x] = 1;
      stack.push({ x, y });
    }
  }
  cells.forEach((c, i) => {
    if (!seen[i] && c.t !== 'water' && c.t !== 'tree') {
      c.t = 'tree';
      c.v = 0;
      delete c.slope;
    }
  });
  // A slope must never roll the ball into something it can't rest on.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      if (c.slope === undefined) continue;
      const tx = x + DIRS[c.slope].x;
      const ty = y + DIRS[c.slope].y;
      if (!inb(tx, ty) || at(tx, ty).t === 'water' || at(tx, ty).t === 'tree' || c.t === 'water' || c.t === 'tree') delete c.slope;
    }

  return { w, h, cells, tee, cup };
}

/**
 * Whether the hole plays: the tee and cup are landable and apart, the cup can be reached by putting alone, and
 * optimal dice play from the tee falls inside `window`. `rain` judges it as it plays in the rain (hits one space
 * shorter, no slope rolling the ball on) — how `tests/rain.test.ts` holds every hole finishable and inside its
 * rainy window; the layouts themselves are generated and pinned on the dry hole.
 */
export function validateHole(
  hole: Hole,
  window: readonly [number, number],
  rain = false,
): { ok: boolean; diceExpected: number } {
  const bad = { ok: false, diceExpected: Infinity };
  if (!isLandable(hole, hole.tee) || !isLandable(hole, hole.cup) || samePos(hole.tee, hole.cup)) return bad;
  if (!puttComponent(hole, hole.tee, rain).has(hole.cup.y * hole.w + hole.cup.x)) return bad;
  const dice = diceExpectedFromTee(hole, rain);
  return { ok: dice >= window[0] && dice <= window[1], diceExpected: dice };
}

// ------------------------------------------------------------------ Proper golf

/** Proper golf: 18 holes, 4 par 3s, 10 par 4s, 4 par 5s; out 36, in 36, par 72. */
export const PROPER_PARS: readonly number[] = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
export const PROPER_HOLES = PROPER_PARS.length;

/** Layout per par: a par 3 is a short carry to a guarded green, a par 5 the full page with two doglegs. */
export const PAR_SHAPES: Readonly<Record<number, HoleShape>> = {
  3: { teeY: [11, 12], cupY: [4, 6], nWay: [0, 1], segments: [0, 1], hazards: 0.6, water: 0.8 },
  4: { teeY: [13, 14], cupY: [3, 4], nWay: [1, 2], segments: [1, 2], hazards: 0.8, water: 0.9 },
  5: { teeY: [15, 16], cupY: [1, 2], nWay: [1, 2], segments: [2, 3], hazards: 1, water: 1 },
};

/** Accepted expected dice strokes (optimal play from the tee) per par: a window just under the par. */
export const PAR_WINDOWS: Readonly<Record<number, readonly [number, number]>> = {
  3: [2.7, 3.3],
  4: [3.55, 4.05],
  5: [4.4, 5.0],
};

export const properPar = (number: number) => itemAt(PROPER_PARS, number - 1, 'proper hole');

// ------------------------------------------------------------------ elevation

/** About one hole in three gets raised or low ground (Derek, 26 Oct 2026); the rest stay level. */
export const ELEVATION_SHARE = 0.34;

/** Tries at a plateau or dip that keeps the hole fair before the hole is left level. */
const ELEVATION_TRIES = 12;

/** The most strokes rain may cost optimal play on an elevated hole: inside the 1.5 any hole is held to, with room. */
const ELEVATION_RAIN_COST = 1.3;

const cellKey = (w: number, p: P) => p.y * w + p.x;

/** The cells of `set` 8-connected to `start`. */
function component(w: number, h: number, set: Set<number>, start: number): Set<number> {
  const out = new Set<number>([start]);
  const stack = [start];
  for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
    const x = k % w;
    const y = Math.floor(k / w);
    for (const d of DIRS) {
      const nx = x + d.x;
      const ny = y + d.y;
      const nk = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !set.has(nk) || out.has(nk)) continue;
      out.add(nk);
      stack.push(nk);
    }
  }
  return out;
}

/**
 * Tidy a blob into one merged shape: drop every cell with no neighbour of its own across a side (a corner-only cell
 * or a lone square would read as a speck, not ground), and keep the biggest 8-connected piece, until nothing changes.
 */
function tidyBlob(w: number, h: number, cells: Set<number>): Set<number> {
  let blob = new Set(cells);
  for (;;) {
    const sided = new Set(
      [...blob].filter((k) => {
        const x = k % w;
        return (x > 0 && blob.has(k - 1)) || (x < w - 1 && blob.has(k + 1)) || blob.has(k - w) || blob.has(k + w);
      }),
    );
    let best = new Set<number>();
    const left = new Set(sided);
    for (const k of sided) {
      if (!left.has(k)) continue;
      const piece = component(w, h, sided, k);
      for (const q of piece) left.delete(q);
      if (piece.size > best.size) best = piece;
    }
    if (best.size === blob.size) return best;
    blob = best;
  }
}

/** A rough ellipse of ground somewhere along the line from the tee to the cup, tidied (`tidyBlob`). */
function elevationBlob(hole: Hole, rng: Rng, avoid: Set<number>): Set<number> {
  const t = randRange(rng, 0.2, 0.85);
  const cx = hole.tee.x + (hole.cup.x - hole.tee.x) * t + randRange(rng, -2.5, 2.5);
  const cy = hole.tee.y + (hole.cup.y - hole.tee.y) * t + randRange(rng, -1.5, 1.5);
  const rx = randRange(rng, 1.3, 2.6);
  const ry = randRange(rng, 1.3, 2.6);
  const raw = new Set<number>();
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const r = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      // A ragged edge, so a plateau reads as torn paper rather than a stamped oval.
      if (r > 1 + randRange(rng, -0.25, 0.25)) continue;
      // Never touching the other blob (a plateau and a dip side by side would read as one step).
      if (DIRS.some((d) => avoid.has(cellKey(hole.w, { x: x + d.x, y: y + d.y })))) continue;
      if (avoid.has(cellKey(hole.w, { x, y }))) continue;
      raw.add(cellKey(hole.w, { x, y }));
    }
  return tidyBlob(hole.w, hole.h, raw);
}

/** `hole` with one plateau, one dip, or one of each, painted from `rng`. Null when a blob came out too small. */
function paintElevation(hole: Hole, rng: Rng): Hole | null {
  const roll = rng();
  const heights: (1 | -1)[] = roll < 0.4 ? [1] : roll < 0.75 ? [-1] : [1, -1];
  const cells = hole.cells.map((c): Cell => ({ ...c }));
  const used = new Set<number>();
  for (const height of heights) {
    const blob = elevationBlob(hole, rng, used);
    if (blob.size < 5) return null;
    for (const k of blob) {
      used.add(k);
      itemAt(cells, k, 'cell').height = height;
    }
  }
  return { ...hole, cells };
}

/**
 * A validated level hole, given raised or low ground on about one hole in three (`ELEVATION_SHARE`). Its own seeded
 * stream, after the layout is chosen, so every layout and its pinned seed stay exactly as they were. The ground has to
 * keep the hole fair: optimal play still inside the par's window, and the rain costing no more than
 * `ELEVATION_RAIN_COST`. Putting home is never in doubt — the ground does not change a putt — so every weather still
 * finishes. A hole whose tries all fail stays level.
 */
function withElevation(hole: Hole, window: readonly [number, number]): { hole: Hole; diceExpected: number } | null {
  const rng = mulberry32(hole.seed ^ 0x5e1e7a7e);
  if (!chance(rng, ELEVATION_SHARE)) return null;
  for (let i = 0; i < ELEVATION_TRIES; i++) {
    const raised = paintElevation(hole, rng);
    if (raised === null) continue;
    const dry = validateHole(raised, window);
    if (!dry.ok) continue;
    if (diceExpectedFromTee(raised, true) - dry.diceExpected > ELEVATION_RAIN_COST) continue;
    return { hole: raised, diceExpected: dry.diceExpected };
  }
  return null;
}

const properCache = new Map<string, { hole: Hole; stats: HoleStats }>();

/** Deterministically generate Proper golf hole `number` (1..18) in the style of course `course` (0..4). */
export function generateProperHole(course: number, number: number): Hole {
  return generateProperHoleWithStats(course, number).hole;
}

export function generateProperHoleWithStats(course: number, number: number): { hole: Hole; stats: HoleStats } {
  const id = `${String(course)}:${String(number)}`;
  const hit = properCache.get(id);
  if (hit) return hit;
  const par = properPar(number);
  const shape = PAR_SHAPES[par];
  const window = PAR_WINDOWS[par];
  if (!shape || !window) throw new Error(`no layout for par ${String(par)}`);
  const difficulty = clamp(itemAt(COURSES, course, 'course').difficulty + (number - 9) * 0.008, 0, 1);
  for (let attempt = 0; attempt < 800; attempt++) {
    // Seed stream number + 100: the retired 12-hole par-6 courses used number itself, so these layouts stay pinned.
    const seed = holeSeed(course, number + 100, attempt);
    const hole: Hole = { id: builtinHoleId(course, number), course, number, seed, par, ...build(seed, difficulty, shape) };
    const v = validateHole(hole, window);
    if (v.ok) {
      const raised = withElevation(hole, window);
      const out = { hole: raised?.hole ?? hole, stats: { diceExpected: raised?.diceExpected ?? v.diceExpected, attempts: attempt + 1 } };
      properCache.set(id, out);
      return out;
    }
  }
  throw new Error(`Could not generate a valid Proper golf hole for course ${String(course)} hole ${String(number)}`);
}

export const _internal = { build };
