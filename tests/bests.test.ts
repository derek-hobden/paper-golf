import { describe, expect, it } from 'vitest';
import { bestKey, courseBest, parseBests, recordBest } from '../src/game/bests';

describe('course bests', () => {
  it('reads Proper golf bests and keeps old 12-hole entries stored but never as a course best', () => {
    // As stored before: `dice:` (12-hole par 6), older `speed:`, and `proper:` (18-hole par 72).
    const bests = parseBests({ 'dice:0': 30, 'speed:1': 40, 'proper:0': 75, 'proper:2': 70 });
    expect(courseBest(bests, 0)).toBe(75);
    expect(courseBest(bests, 1)).toBeUndefined();
    expect(courseBest(bests, 2)).toBe(70);
    expect(bestKey(4)).toBe('proper:4');
    // A worse par-72 round never loses to the old 12-hole 30 on course 0, and the old entry is left alone.
    expect(recordBest(bests, 0, 80)).toBe(false);
    expect(recordBest(bests, 0, 74)).toBe(true);
    expect(bests).toEqual({ 'dice:0': 30, 'speed:1': 40, 'proper:0': 74, 'proper:2': 70 });
  });

  it('records a first best on a course with only an old 12-hole best', () => {
    const bests = parseBests({ 'dice:3': 25 });
    expect(courseBest(bests, 3)).toBeUndefined();
    expect(recordBest(bests, 3, 90)).toBe(true);
    expect(bests).toEqual({ 'dice:3': 25, 'proper:3': 90 });
    expect(recordBest(bests, 3, 90)).toBe(false);
  });

  it('never throws on odd saved data, keeping only finite numbers', () => {
    for (const v of [null, undefined, 0, 'x', [], [70], true]) expect(parseBests(v)).toEqual({});
    expect(parseBests({ 'proper:0': '70', 'proper:1': null, 'proper:2': NaN, 'proper:3': Infinity, 'proper:4': 71, x: {} })).toEqual({
      'proper:4': 71,
    });
  });
});
