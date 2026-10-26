import { must } from './assert';
import { gridAt } from './grid';
import type { Cell, Dir, Height, Hole, P } from './types';

const SLOPES: Record<string, Dir> = { '^': 0, '>': 2, v: 4, '<': 6 };
const HEIGHTS: Record<string, Height> = { '+': 1, '-': -1, '.': 0, ' ': 0 };

/**
 * Build a hole from an ASCII map (handy for tests and debugging).
 * `.` rough, `f` fairway, `s` sand, `w` water, `T` tree, `^ > v <` slope on rough,
 * `O` ball/tee (on fairway), `o` ball/tee (on rough), `@` cup (on fairway).
 *
 * `heights` is a second map of the same size, read on top of the first: `+` a plateau, `-` a dip, `.` or a space
 * level. Left out, the whole page is level.
 */
export function holeFromAscii(rows: string[], heights?: string[]): Hole {
  const h = rows.length;
  const w = must(rows[0], 'an ASCII hole needs at least one row').length;
  const cells: Cell[] = [];
  let tee: P = { x: 0, y: 0 };
  let cup: P = { x: 0, y: 0 };
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`row ${String(y)} has length ${String(row.length)}, expected ${String(w)}`);
    for (let x = 0; x < w; x++) {
      const ch = row.charAt(x);
      switch (ch) {
        case '.':
          cells.push({ t: 'rough' });
          break;
        case 'f':
          cells.push({ t: 'fairway' });
          break;
        case 's':
          cells.push({ t: 'sand' });
          break;
        case 'w':
          cells.push({ t: 'water' });
          break;
        case 'T':
          cells.push({ t: 'tree' });
          break;
        case 'O':
          tee = { x, y };
          cells.push({ t: 'fairway' });
          break;
        case 'o':
          tee = { x, y };
          cells.push({ t: 'rough' });
          break;
        case '@':
          cup = { x, y };
          cells.push({ t: 'fairway' });
          break;
        default: {
          const slope = SLOPES[ch];
          if (slope === undefined) throw new Error(`unknown map char ${ch}`);
          cells.push({ t: 'rough', slope });
        }
      }
    }
  });
  if (heights !== undefined) {
    if (heights.length !== h) throw new Error(`the height map has ${String(heights.length)} rows, expected ${String(h)}`);
    heights.forEach((row, y) => {
      if (row.length !== w) throw new Error(`height row ${String(y)} has length ${String(row.length)}, expected ${String(w)}`);
      for (let x = 0; x < w; x++) {
        const ch = row.charAt(x);
        const z = HEIGHTS[ch];
        if (z === undefined) throw new Error(`unknown height char ${ch}`);
        if (z !== 0) gridAt(cells, w, x, y).z = z;
      }
    });
  }
  return { course: 0, number: 1, seed: 0, w, h, cells, tee, cup, par: 4 };
}

export function holeToAscii(hole: Hole): string[] {
  const rows: string[] = [];
  const arrows = ['^', '/', '>', '\\', 'v', '/', '<', '\\'] as const;
  for (let y = 0; y < hole.h; y++) {
    let s = '';
    for (let x = 0; x < hole.w; x++) {
      const c = gridAt(hole.cells, hole.w, x, y);
      if (x === hole.tee.x && y === hole.tee.y) s += 'O';
      else if (x === hole.cup.x && y === hole.cup.y) s += '@';
      else if (c.slope !== undefined) s += arrows[c.slope];
      else s += { rough: '.', fairway: 'f', sand: 's', water: 'w', tree: 'T' }[c.t];
    }
    rows.push(s);
  }
  return rows;
}
