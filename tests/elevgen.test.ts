import { describe, expect, it } from 'vitest';
import { PAR_WINDOWS, generateProperHole } from '../src/engine/generator';
import { heightAt, movesForRoll } from '../src/engine/rules';
import { diceExpectedFromTee } from '../src/engine/solver';
import type { Hole, P } from '../src/engine/types';
import { at, defined, levelled } from './helpers';
import { EVERY_HOLE } from './sweep';

// The 90 holes are generated once here, at module scope: a sweep that generates a course inside one test runs it
// against the 30s per-test timeout (tests/sweep.ts), so the cases below only read what this left.
const holes: Hole[] = EVERY_HOLE.map(({ c, n }) => generateProperHole(c, n));

const heights = (hole: Hole) => hole.cells.map((c) => c.z ?? 0);
const hasRelief = (hole: Hole) => heights(hole).some((z) => z !== 0);

/** The cells of one height, grouped into 4-connected regions: the plateaus and dips of a hole. */
function regions(hole: Hole): { z: number; size: number }[] {
  const seen = new Set<number>();
  const out: { z: number; size: number }[] = [];
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++) {
      const k = y * hole.w + x;
      const z = heightAt(hole, { x, y });
      if (z === 0 || seen.has(k)) continue;
      let size = 0;
      const stack: P[] = [{ x, y }];
      seen.add(k);
      for (let p = stack.pop(); p; p = stack.pop()) {
        size++;
        for (const d of [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ]) {
          const q = { x: p.x + d.x, y: p.y + d.y };
          const j = q.y * hole.w + q.x;
          if (q.x < 0 || q.y < 0 || q.x >= hole.w || q.y >= hole.h || seen.has(j) || heightAt(hole, q) !== z) continue;
          seen.add(j);
          stack.push(q);
        }
      }
      out.push({ z, size });
    }
  return out;
}

const elevated = holes.filter(hasRelief);

describe('the generator lays some holes out with elevation', () => {
  it('gives it to roughly one hole in three, and leaves the rest level', () => {
    expect(holes).toHaveLength(90);
    expect(elevated.length).toBeGreaterThanOrEqual(18);
    expect(elevated.length).toBeLessThanOrEqual(45);
    expect(holes.filter((h) => !hasRelief(h)).every((h) => heights(h).every((z) => z === 0))).toBe(true);
  });

  it('only ever raises or lowers by one level', () => {
    expect(new Set(holes.flatMap(heights))).toEqual(new Set([0, -1, 1]));
  });

  it('shapes it as one plateau or dip, or one of each — merged blobs, never a lone cell', () => {
    for (const hole of elevated) {
      const found = regions(hole);
      const where = `course ${String(hole.course)} hole ${String(hole.number)}`;
      expect(found.length, where).toBeGreaterThanOrEqual(1);
      expect(found.length, where).toBeLessThanOrEqual(2);
      expect(found.every((r) => r.size >= 3), `${where}: ${JSON.stringify(found)}`).toBe(true);
      // One of each at most: two plateaus or two dips would read as one shape with a seam.
      expect(new Set(found.map((r) => r.z)).size, where).toBe(found.length);
    }
  });

  it('reaches the shots a hole offers, and the par it is held to', () => {
    const hole = at(elevated, 0);
    const flat = levelled(hole);
    const shots = (h: Hole) => {
      const out: string[] = [];
      for (let y = 0; y < h.h; y++)
        for (let x = 0; x < h.w; x++)
          for (let r = 1; r <= 6; r++)
            for (const m of movesForRoll(h, { x, y }, r)) out.push(`${String(x)},${String(y)},${String(r)},${String(m.dir)}=${String(m.result.end.x)},${String(m.result.end.y)}`);
      return out.join('|');
    };
    // The hole plays differently from the same page laid flat, and still inside its par's window.
    expect(shots(hole)).not.toBe(shots(flat));
    const [lo, hi] = defined(PAR_WINDOWS[hole.par], 'par window');
    const expected = diceExpectedFromTee(hole);
    expect(expected).toBeGreaterThanOrEqual(lo);
    expect(expected).toBeLessThanOrEqual(hi);
  });

  it('writes a height on no cell that is level: a level page carries no `z` at all', () => {
    for (const hole of holes) {
      for (let i = 0; i < hole.cells.length; i++) {
        const z = at(hole.cells, i).z;
        expect(z === undefined || z === 1 || z === -1, `course ${String(hole.course)} hole ${String(hole.number)} cell ${String(i)}`).toBe(true);
      }
    }
  });
});
