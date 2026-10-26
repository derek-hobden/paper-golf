import { describe, expect, it } from 'vitest';
import {
  applyTool,
  blankDraft,
  decodeHole,
  draftsEqual,
  draftToHole,
  encodeHole,
  holeToDraft,
  previewHole,
  readyHole,
  whyUnplayable,
  type Draft,
} from '../src/engine/builder';
import { GRID_H, GRID_W, PROPER_HOLES, generateProperHole } from '../src/engine/generator';
import { gridAt } from '../src/engine/grid';
import { heightAt } from '../src/engine/rules';
import { finishableCells } from '../src/engine/solver';
import type { Hole, P } from '../src/engine/types';
import { EVERY_WIND } from '../src/engine/wind';
import { addHole, emptyLibrary, parseLibrary } from '../src/game/library';
import { at, defined } from './helpers';
import { EVERY_COURSE, EVERY_HOLE } from './sweep';

/** The raised and the low regions of a hole: each one a set of 8-connected cells of the same height. */
function regions(hole: Hole): { height: number; cells: P[] }[] {
  const seen = new Set<number>();
  const out: { height: number; cells: P[] }[] = [];
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const height = heightAt(hole, { x, y });
      if (height === 0 || seen.has(y * hole.w + x)) continue;
      const cells: P[] = [];
      const stack: P[] = [{ x, y }];
      seen.add(y * hole.w + x);
      for (let p = stack.pop(); p; p = stack.pop()) {
        cells.push(p);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const q = { x: p.x + dx, y: p.y + dy };
            if (q.x < 0 || q.y < 0 || q.x >= hole.w || q.y >= hole.h || seen.has(q.y * hole.w + q.x)) continue;
            if (heightAt(hole, q) !== height) continue;
            seen.add(q.y * hole.w + q.x);
            stack.push(q);
          }
      }
      out.push({ height, cells });
    }
  return out;
}

const elevated = (hole: Hole) => hole.cells.some((c) => c.height !== undefined);

describe('elevation on the generated holes', () => {
  it.each(EVERY_COURSE)('course %i raises or lowers the ground on roughly one hole in three', (c) => {
    const count = Array.from({ length: PROPER_HOLES }, (_, i) => generateProperHole(c, i + 1)).filter(elevated).length;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(10);
  });

  it.each(EVERY_HOLE)('course $c hole $n: blobs of several cells, at most one plateau and one dip', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    // A level cell carries no height at all, so a flat hole is exactly the hole it was before elevation.
    expect(hole.cells.every((cell) => !('height' in cell) || cell.height !== undefined)).toBe(true);
    const found = regions(hole);
    expect(found.filter((r) => r.height === 1).length).toBeLessThanOrEqual(1);
    expect(found.filter((r) => r.height === -1).length).toBeLessThanOrEqual(1);
    for (const r of found) {
      expect(r.cells.length).toBeGreaterThanOrEqual(4);
      // Never a lone cell sticking out: every cell has a neighbour of its own height across a side.
      for (const p of r.cells) {
        const sides = [
          { x: p.x + 1, y: p.y },
          { x: p.x - 1, y: p.y },
          { x: p.x, y: p.y + 1 },
          { x: p.x, y: p.y - 1 },
        ];
        expect(sides.some((q) => q.x >= 0 && q.y >= 0 && q.x < hole.w && q.y < hole.h && heightAt(hole, q) === r.height)).toBe(true);
      }
    }
  });

  it.each(EVERY_HOLE)('course $c hole $n plays from the tee in every wind, wet or dry', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    if (!elevated(hole)) return;
    const tee = hole.tee.y * hole.w + hole.tee.x;
    for (const wind of EVERY_WIND) {
      expect(finishableCells(hole, wind).has(tee)).toBe(true);
      expect(finishableCells(hole, wind, true).has(tee)).toBe(true);
    }
  });
});

/** A playable draft: a fairway column from the tee up to the pin. */
function drawn(): Draft {
  let d = blankDraft();
  for (let y = 2; y <= 18; y++) d = applyTool(d, 6, y, 'fairway');
  d = applyTool(d, 6, 18, 'tee');
  return applyTool(d, 6, 2, 'pin');
}

const heightOf = (d: Draft, x: number, y: number) => gridAt(d.cells, GRID_W, x, y).height ?? 0;

describe('the builder height tool', () => {
  it('cycles a square through level, raised and low', () => {
    let d = blankDraft();
    d = applyTool(d, 3, 3, 'height');
    expect(heightOf(d, 3, 3)).toBe(1);
    d = applyTool(d, 3, 3, 'height');
    expect(heightOf(d, 3, 3)).toBe(-1);
    d = applyTool(d, 3, 3, 'height');
    expect(heightOf(d, 3, 3)).toBe(0);
    // Level again is no height at all, so the draft is the blank page it was.
    expect(draftsEqual(d, blankDraft())).toBe(true);
  });

  it('paints the height a drag started with, and keeps the ground under it', () => {
    let d = applyTool(blankDraft(), 4, 4, 'sand');
    d = applyTool(d, 4, 4, 'height', -1);
    d = applyTool(d, 5, 4, 'height', -1);
    expect(gridAt(d.cells, GRID_W, 4, 4)).toEqual({ t: 'sand', height: -1 });
    expect(heightOf(d, 5, 4)).toBe(-1);
    // Painting ground over a height keeps it (heights do not care what the ground is); Erase levels it.
    d = applyTool(d, 4, 4, 'water');
    expect(gridAt(d.cells, GRID_W, 4, 4)).toEqual({ t: 'water', height: -1 });
    d = applyTool(d, 4, 4, 'erase');
    expect(gridAt(d.cells, GRID_W, 4, 4)).toEqual({ t: 'rough' });
  });

  it('carries the heights into the hole it plays and back', () => {
    let d = drawn();
    for (let y = 8; y <= 10; y++) for (let x = 5; x <= 7; x++) d = applyTool(d, x, y, 'height', 1);
    const hole = defined(draftToHole(d), 'hole');
    expect(heightAt(hole, { x: 6, y: 9 })).toBe(1);
    expect(holeToDraft(hole)).toEqual(d);
    expect(draftsEqual(d, drawn())).toBe(false);
    expect(readyHole(d).ok).toBe(true);
  });
});

/** A token as the builder wrote it before elevation: version 1, the header, one byte per cell. */
function v1Token(hole: Hole): string {
  const bytes = [1, hole.par, hole.tee.x, hole.tee.y, hole.cup.x, hole.cup.y];
  for (const c of hole.cells) bytes.push(['rough', 'fairway', 'sand', 'water', 'tree'].indexOf(c.t) | ((c.slope === undefined ? 0 : c.slope + 1) << 3));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

const tokenBytes = (token: string) => Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

describe('hole links with heights', () => {
  const flat = () => defined(draftToHole(drawn()), 'flat hole');
  const hilly = () => {
    let d = drawn();
    for (let y = 8; y <= 10; y++) for (let x = 5; x <= 7; x++) d = applyTool(d, x, y, 'height', 1);
    for (let y = 13; y <= 14; y++) for (let x = 0; x <= 2; x++) d = applyTool(d, x, y, 'height', -1);
    return defined(draftToHole(d), 'hilly hole');
  };

  it('still opens a link made before heights, as level ground everywhere', () => {
    const hole = flat();
    const back = defined(decodeHole(v1Token(hole)), 'old link');
    expect(back.cells).toEqual(hole.cells);
    expect(back.cells.every((c) => c.height === undefined)).toBe(true);
  });

  it('writes a level hole exactly as before, so its link is the same link', () => {
    const hole = flat();
    expect(encodeHole(hole)).toBe(v1Token(hole));
  });

  it('carries the heights in a version 2 link', () => {
    const hole = hilly();
    const token = defined(encodeHole(hole), 'token');
    expect(token).not.toMatch(/[+/=]/u);
    expect(at(tokenBytes(token), 0)).toBe(2);
    const back = defined(decodeHole(token), 'new link');
    expect(back.cells).toEqual(hole.cells);
    expect(heightAt(back, { x: 6, y: 9 })).toBe(1);
    expect(heightAt(back, { x: 1, y: 14 })).toBe(-1);
    expect(whyUnplayable(back)).toBeNull();
  });

  it('refuses a version 2 link with a height that is not one of the three, or the wrong length', () => {
    const token = defined(encodeHole(hilly()), 'token');
    const bytes = tokenBytes(token);
    const write = (b: Uint8Array) => {
      let bin = '';
      for (const x of b) bin += String.fromCharCode(x);
      return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    };
    const bad = bytes.slice();
    bad[bad.length - 1] = 0xff;
    expect(decodeHole(write(bad))).toBeNull();
    expect(decodeHole(write(bytes.slice(0, -1)))).toBeNull();
    // A version 1 header in front of height bytes is not a hole either.
    const mislabelled = bytes.slice();
    mislabelled[0] = 1;
    expect(decodeHole(write(mislabelled))).toBeNull();
    expect(GRID_W * GRID_H).toBe(260);
  });
});

describe('saved holes with heights', () => {
  it('reads the heights back, and drops a hole with a height that is not -1 or +1', () => {
    let d = drawn();
    d = applyTool(d, 6, 9, 'height', 1);
    d = applyTool(d, 6, 10, 'height', 1);
    const hole = defined(draftToHole(d), 'hole');
    const { lib } = addHole(emptyLibrary(), 'Hill', hole, 5);
    expect(parseLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
    const saved = at(lib.holes, 0);
    for (const height of [0, 2, -2, '1']) {
      const cells = saved.hole.cells.map((c, i) => (i === 0 ? { ...c, height } : c));
      expect(parseLibrary({ version: 1, holes: [{ ...saved, hole: { ...saved.hole, cells } }], courses: [] }).holes, String(height)).toEqual([]);
    }
    expect(previewHole(holeToDraft(saved.hole) ?? d).cells).toEqual(hole.cells);
  });
});
