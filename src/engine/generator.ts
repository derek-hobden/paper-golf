import { itemAt } from './assert';
import { gridAt } from './grid';
import { builtinHoleId } from './holeid';
import { chance, mulberry32, pick, randInt, randRange, type Rng } from './rng';
import { isLandable, samePos } from './rules';
import { diceExpectation, diceExpectedFromTee, puttComponent } from './solver';
import { DIRS, type Cell, type Dir, type Height, type Hole, type P, type Terrain } from './types';

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

// ------------------------------------------------------------------ elevation

/** About one hole in three is laid out with elevation; the rest of the page is level all through. */
const RELIEF_CHANCE = 0.33;
/** How many shapes a hole tries before it stays level. Each one costs the solver two runs. */
const RELIEF_TRIES = 3;
/** The most strokes a plateau or a dip may cost optimal play in the rain, over the same hole in the dry. */
const RELIEF_RAIN_COST = 0.9;
/** Cells in one plateau or dip: a merged blob, never a lone cell. */
const RELIEF_SIZE: readonly [number, number] = [4, 9];

/**
 * The tee and the cup, with the ring of cells round each, stay level: a shape that stopped at the tee or the cup would
 * be drawn with a hole in it, and a tee that sits a level up or down would quietly change every tee shot on the hole
 * (the wind screenshots in `tests/windbugs.test.ts` are all tee shots). A ball resting on a plateau out on the course
 * still plays every direction downhill.
 */
function nearTeeOrCup(hole: Hole, p: P): boolean {
  const near = (q: P) => Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) <= 1;
  return near(hole.tee) || near(hole.cup);
}

const ORTHO: readonly P[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * One plateau or dip on `z`: a blob grown a cell at a time from its own 4-neighbours, so it is always one merged
 * shape (the board draws a region as one outline, and single cells or a diagonal seam would show). It starts on
 * ground a ball can rest on, so the shape lands where it is played over rather than inside a wood or a pond.
 * Returns its size.
 */
function reliefBlob(hole: Hole, rng: Rng, z: Height[], level: Height): number {
  const w = hole.w;
  const h = hole.h;
  const free = (p: P) =>
    p.x >= 0 && p.y >= 0 && p.x < w && p.y < h && itemAt(z, p.y * w + p.x, 'height') === 0 && !nearTeeOrCup(hole, p);
  const spot = (): P => ({ x: clamp(randInt(rng, 2, w - 3), 0, w - 1), y: clamp(randInt(rng, 3, h - 4), 0, h - 1) });
  let start = spot();
  for (let tries = 0; tries < 8 && !(isLandable(hole, start) && free(start)); tries++) start = spot();
  if (!isLandable(hole, start) || !free(start)) return 0;
  const grown: P[] = [start];
  z[start.y * w + start.x] = level;
  const target = randInt(rng, ...RELIEF_SIZE);
  for (let guard = 0; grown.length < target && guard < target * 8; guard++) {
    const from = pick(rng, grown);
    const d = pick(rng, ORTHO);
    const p: P = { x: from.x + d.x, y: from.y + d.y };
    if (!free(p)) continue;
    z[p.y * w + p.x] = level;
    grown.push(p);
  }
  return grown.length;
}

/** A plateau, a dip, or one of each: the heights to try on a hole. Null when this hole stays level. */
function reliefMap(hole: Hole, rng: Rng): Height[] | null {
  const z: Height[] = Array.from({ length: hole.w * hole.h }, (): Height => 0);
  const levels: Height[] = chance(rng, 0.3) ? [1, -1] : [chance(rng, 0.5) ? 1 : -1];
  for (const level of levels) if (reliefBlob(hole, rng, z, level) < RELIEF_SIZE[0]) return null;
  return z.some((v) => v !== 0) ? z : null;
}

/** `hole` with `z` written onto its cells (level cells carry no `z` at all, as a hole drawn before elevation does). */
function withHeights(hole: Hole, z: readonly Height[]): Hole {
  return {
    ...hole,
    cells: hole.cells.map((c, i) => {
      const level = z[i] ?? 0;
      return level === 0 ? c : { ...c, z: level };
    }),
  };
}

/**
 * Whether a hole plays as fairly with its elevation as it did without: every cell a ball can rest on still finishes,
 * optimal play from the tee is still inside the par's `window`, and the rain costs no more than `RELIEF_RAIN_COST`
 * strokes over the dry hole (`tests/rainsolver.test.ts` holds every hole to a wider version of the same rule).
 * Putting is untouched by elevation, so the cup stays reachable by putting alone, wet or dry.
 */
function reliefPlays(hole: Hole, window: readonly [number, number]): number | null {
  const dry = diceExpectation(hole);
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      if (isLandable(hole, { x, y }) && !Number.isFinite(itemAt(dry, y * hole.w + x, 'cell value'))) return null;
    }
  const tee = itemAt(dry, hole.tee.y * hole.w + hole.tee.x, 'tee cell');
  if (tee < window[0] || tee > window[1]) return null;
  const wet = diceExpectedFromTee(hole, true);
  if (!Number.isFinite(wet) || wet < window[0] || wet - tee > RELIEF_RAIN_COST) return null;
  return tee;
}

/**
 * Elevation on a generated hole: about one in three gets a raised plateau, a dip, or one of each, as merged blobs of
 * several cells. It is a seeded pass over the layout the seed search already accepted, from a stream of its own, so
 * the 90 pinned layouts stay exactly as they are (`tests/proper.test.ts`) and only the heights are new. A shape is
 * kept only when the hole still plays to its par with it (`reliefPlays`), which is how the solver — not a hand-tweak
 * — keeps par fair; a hole whose shapes all fail stays level.
 */
function withRelief(hole: Hole, window: readonly [number, number], dry: number): { hole: Hole; diceExpected: number } {
  const rng: Rng = mulberry32((hole.seed ^ 0xe1e4a7) >>> 0);
  if (!chance(rng, RELIEF_CHANCE)) return { hole, diceExpected: dry };
  for (let attempt = 0; attempt < RELIEF_TRIES; attempt++) {
    const z = reliefMap(hole, rng);
    if (z === null) continue;
    const raised = withHeights(hole, z);
    const expected = reliefPlays(raised, window);
    if (expected !== null) return { hole: raised, diceExpected: expected };
  }
  return { hole, diceExpected: dry };
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
      const relief = withRelief(hole, window, v.diceExpected);
      const out = { hole: relief.hole, stats: { diceExpected: relief.diceExpected, attempts: attempt + 1 } };
      properCache.set(id, out);
      return out;
    }
  }
  throw new Error(`Could not generate a valid Proper golf hole for course ${String(course)} hole ${String(number)}`);
}

export const _internal = { build };
