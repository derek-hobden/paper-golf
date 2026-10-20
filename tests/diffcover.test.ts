import { describe, expect, it } from 'vitest';
import { passes, scoreDiff } from './diffcover';

const diff = [
  'diff --git a/src/engine/a.ts b/src/engine/a.ts',
  '--- a/src/engine/a.ts',
  '+++ b/src/engine/a.ts',
  '@@ -1,0 +1,4 @@',
  '+export const a = 1;',
  '+// note',
  '+',
  '+export const b = 2;',
  'diff --git a/src/ui/board.ts b/src/ui/board.ts',
  '--- a/src/ui/board.ts',
  '+++ b/src/ui/board.ts',
  '@@ -1 +1 @@',
  '+export const ui = 1;',
].join('\n');

const coverage = {
  '/repo/src/engine/a.ts': {
    statementMap: {
      '0': { start: { line: 1 }, end: { line: 1 } },
      '1': { start: { line: 4 }, end: { line: 4 } },
    },
    s: { '0': 1, '1': 0 },
  },
};

describe('changed-line coverage', () => {
  it('ignores comments, blanks and files outside engine and game', () => {
    const score = scoreDiff(diff, coverage);
    expect(score.coverable).toBe(2);
    expect(score.covered).toBe(1);
    expect(score.percent).toBe(50);
    expect(score.missing).toBe(false);
    expect(passes(score)).toBe(false);
  });

  it('passes when every changed statement is hit', () => {
    const report = {
      '/repo/src/engine/a.ts': {
        statementMap: {
          '0': { start: { line: 1 }, end: { line: 1 } },
          '1': { start: { line: 4 }, end: { line: 4 } },
        },
        s: { '0': 3, '1': 1 },
      },
    };
    const score = scoreDiff(diff, report);
    expect(score.percent).toBe(100);
    expect(passes(score)).toBe(true);
  });

  it('passes at exactly 80% and fails under it', () => {
    const five = [
      'diff --git a/src/engine/a.ts b/src/engine/a.ts',
      '--- a/src/engine/a.ts',
      '+++ b/src/engine/a.ts',
      '@@ -0,0 +1,5 @@',
      '+export const a = 1;',
      '+export const b = 2;',
      '+export const c = 3;',
      '+export const d = 4;',
      '+export const e = 5;',
    ].join('\n');
    const statementMap = {
      '0': { start: { line: 1 }, end: { line: 1 } },
      '1': { start: { line: 2 }, end: { line: 2 } },
      '2': { start: { line: 3 }, end: { line: 3 } },
      '3': { start: { line: 4 }, end: { line: 4 } },
      '4': { start: { line: 5 }, end: { line: 5 } },
    };
    const eighty = scoreDiff(five, {
      '/repo/src/engine/a.ts': { statementMap, s: { '0': 1, '1': 1, '2': 1, '3': 1, '4': 0 } },
    });
    expect(eighty.coverable).toBe(5);
    expect(eighty.covered).toBe(4);
    expect(eighty.percent).toBe(80);
    expect(passes(eighty)).toBe(true);
    const sixty = scoreDiff(five, {
      '/repo/src/engine/a.ts': { statementMap, s: { '0': 1, '1': 1, '2': 1, '3': 0, '4': 0 } },
    });
    expect(sixty.covered).toBe(3);
    expect(sixty.percent).toBe(60);
    expect(passes(sixty)).toBe(false);
  });

  it('passes when nothing coverable changed', () => {
    const onlyComment = [
      'diff --git a/src/game/game.ts b/src/game/game.ts',
      '--- a/src/game/game.ts',
      '+++ b/src/game/game.ts',
      '@@ -2 +2 @@',
      '+// a comment',
    ].join('\n');
    const score = scoreDiff(onlyComment, { '/repo/src/game/game.ts': { statementMap: {}, s: {} } });
    expect(score.coverable).toBe(0);
    expect(passes(score)).toBe(true);
  });

  it('fails when the coverage file is missing and code changed', () => {
    const score = scoreDiff(diff, null);
    expect(score.missing).toBe(true);
    expect(score.covered).toBe(0);
    expect(passes(score)).toBe(false);
  });

  it('counts a file the report never saw as uncovered', () => {
    const score = scoreDiff(diff, {});
    expect(score.coverable).toBe(2);
    expect(score.covered).toBe(0);
    expect(score.missing).toBe(false);
    expect(passes(score)).toBe(false);
  });
});
