import { chance, mulberry32, randInt, randRange, type Rng } from './rng';
import { PAR, isLandable, samePos } from './rules';
import { diceExpectedFromTee, puttComponent } from './solver';
import { DIRS, type Cell, type Dir, type Hole, type P, type Terrain } from './types';

export const GRID_W = 13;
export const GRID_H = 20;
export const HOLES_PER_COURSE = 12;

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

/** Accepted difficulty window for generated holes. */
export const LIMITS = {
  diceMin: 3.8,
  diceMax: 7.2,
};

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

function build(seed: number, difficulty: number): Draft {
  const rng: Rng = mulberry32(seed);
  const w = GRID_W;
  const h = GRID_H;
  const cells: Cell[] = Array.from({ length: w * h }, () => ({ t: 'rough' as Terrain }));
  const at = (x: number, y: number) => cells[y * w + x];
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

  // Occasionally flip the hole so it plays top-to-bottom or sideways-ish via doglegs.
  const tee: P = { x: randInt(rng, 2, w - 3), y: randInt(rng, h - 3, h - 2) };
  const cup: P = { x: randInt(rng, 2, w - 3), y: randInt(rng, 1, 3) };
  const nWay = randInt(rng, 1, 2);
  const pts: P[] = [tee];
  for (let i = 1; i <= nWay; i++) {
    const t = i / (nWay + 1);
    const base = tee.x + (cup.x - tee.x) * t;
    const swing = randRange(rng, -5, 5) * (0.5 + difficulty * 0.5);
    pts.push({ x: clamp(Math.round(base + swing), 1, w - 2), y: Math.round(tee.y + (cup.y - tee.y) * t) });
  }
  pts.push(cup);

  // Arc-length sampling along the polyline.
  const segLen = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = segLen.reduce((a, b) => a + b, 0);
  const sample = (f: number): { x: number; y: number; nx: number; ny: number } => {
    let d = clamp(f, 0, 1) * total;
    for (let i = 0; i < segLen.length; i++) {
      if (d <= segLen[i] || i === segLen.length - 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const u = segLen[i] ? clamp(d / segLen[i], 0, 1) : 0;
        const dx = (b.x - a.x) / (segLen[i] || 1);
        const dy = (b.y - a.y) / (segLen[i] || 1);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, nx: -dy, ny: dx };
      }
      d -= segLen[i];
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
      const d = DIRS[randInt(rng, 0, 7)];
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
  const segments = difficulty < 0.35 ? randInt(rng, 2, 3) : difficulty < 0.75 ? 2 : randInt(rng, 1, 2);
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
  const treeClusters = randInt(rng, 3, 4) + Math.round(difficulty * 3);
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
  const ponds = (chance(rng, 0.25 + difficulty * 0.5) ? 1 : 0) + (difficulty > 0.6 && chance(rng, 0.5) ? 1 : 0);
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
  const traps = randInt(rng, 1, 2) + Math.round(difficulty * 2);
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
  const slopes = randInt(rng, 1, 3) + Math.round(difficulty * 3);
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
  while (stack.length) {
    const p = stack.pop()!;
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
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!seen[i] && c.t !== 'water' && c.t !== 'tree') {
      c.t = 'tree';
      c.v = 0;
      delete c.slope;
    }
  }
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

export function validateHole(hole: Hole): { ok: boolean; diceExpected: number } {
  const bad = { ok: false, diceExpected: Infinity };
  if (!isLandable(hole, hole.tee) || !isLandable(hole, hole.cup) || samePos(hole.tee, hole.cup)) return bad;
  if (!puttComponent(hole, hole.tee).has(hole.cup.y * hole.w + hole.cup.x)) return bad;
  const dice = diceExpectedFromTee(hole);
  return { ok: dice >= LIMITS.diceMin && dice <= LIMITS.diceMax, diceExpected: dice };
}

const cache = new Map<string, { hole: Hole; stats: HoleStats }>();

/** Deterministically generate hole `number` (1..12) of course `course` (0..4). */
export function generateHole(course: number, number: number): Hole {
  return generateHoleWithStats(course, number).hole;
}

export function generateHoleWithStats(course: number, number: number): { hole: Hole; stats: HoleStats } {
  const id = `${course}:${number}`;
  const hit = cache.get(id);
  if (hit) return hit;
  // Difficulty ramps gently within a course too.
  const difficulty = clamp(COURSES[course].difficulty + (number - 6) * 0.012, 0, 1);
  for (let attempt = 0; attempt < 500; attempt++) {
    const seed = holeSeed(course, number, attempt);
    const d = build(seed, difficulty);
    const hole: Hole = { course, number, seed, par: PAR, ...d };
    const v = validateHole(hole);
    if (v.ok) {
      const out = { hole, stats: { diceExpected: v.diceExpected, attempts: attempt + 1 } };
      cache.set(id, out);
      return out;
    }
  }
  throw new Error(`Could not generate a valid hole for course ${course} hole ${number}`);
}

export function generateCourse(course: number): Hole[] {
  return Array.from({ length: HOLES_PER_COURSE }, (_, i) => generateHole(course, i + 1));
}

export const _internal = { build };
