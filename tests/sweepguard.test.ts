/**
 * The sweep guard is a lint rule (`no-restricted-syntax` for `tests/**` in eslint.config.js), so these cases
 * prove it fires: the three shapes that timed a test out (issues 8, 9 and 17) are rejected, and the shapes the
 * suite legitimately uses are not. Without them the selector could stop matching and the Guard rules row would
 * claim an enforcement that no longer happens.
 *
 * Each snippet is linted through the real config, as a test file (`--stdin-filename`): the path has to be one
 * the project service knows, so it is this suite's own `tests/green.test.ts` with the snippet as its text.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const SWEEP_RULE = 'Sweep the course with it.each';

/** How many times the sweep rule fires on `code` linted as a test file. */
function sweepErrors(code: string): number {
  const run = spawnSync('npx', ['eslint', '--stdin', '--stdin-filename', 'tests/green.test.ts'], {
    encoding: 'utf8',
    input: code,
  });
  // eslint prints its findings on stdout and exits 1 while any remain; anything on stderr, or any other
  // non-zero exit, means it never linted the snippet (a bad flag, a missing formatter, a crash).
  if (run.stderr !== '' || (run.status !== 0 && run.status !== 1)) throw new Error(`eslint did not lint the snippet:\n${run.stdout}${run.stderr}`);
  if (run.stdout.includes('Parsing error')) throw new Error(`eslint could not parse the snippet:\n${run.stdout}`);
  return run.stdout.split(SWEEP_RULE).length - 1;
}

const HEAD = [
  "import { it } from 'vitest';",
  "import { COURSES, PROPER_HOLES, generateProperHole, generateProperHoleWithStats } from '../src/engine/generator';",
  "import { diceExpectation } from '../src/engine/solver';",
  "import { currentHole, newGame, nextHole } from '../src/game/game';",
  "import { EVERY_COURSE, EVERY_HOLE } from './sweep';",
].join('\n');

const snippet = (body: string) => `${HEAD}\n${body}\n`;

/** The three sweeps that ran against the 30s per-test timeout, each in the shape it had. */
const REJECTED = {
  'issue 9: nested index loops over courses and holes': snippet(`it('x', () => {
    for (let c = 0; c < COURSES.length; c++)
      for (let n = 1; n <= PROPER_HOLES; n++) diceExpectation(generateProperHole(c, n));
  });`),
  'issue 17: map over the courses, Array.from over the holes': snippet(`it('x', () => {
    COURSES.map((_, c) => Array.from({ length: PROPER_HOLES }, (_, i) => generateProperHoleWithStats(c, i + 1).hole.seed));
  });`),
  "issue 8: a loop over the courses around the round's own loop": snippet(`it('x', () => {
    for (let course = 0; course < 5; course++) {
      const g = newGame(course, ['A']);
      while (!g.finished) {
        diceExpectation(currentHole(g));
        nextHole(g);
      }
    }
  });`),
};

/** What the suite does instead, and what it has always done: none of it is a whole-course sweep in one test. */
const ACCEPTED = {
  'one case per hole': snippet(`it.each(EVERY_HOLE)('x $c $n', ({ c, n }) => {
    diceExpectation(generateProperHole(c, n));
  });`),
  "one case per course, with the round's own loop": snippet(`it.each(EVERY_COURSE)('x %i', (course) => {
    const g = newGame(course, ['A']);
    while (!g.finished) {
      diceExpectation(currentHole(g));
      nextHole(g);
    }
  });`),
  "one course's 18 holes in one test": snippet(`it('x', () => {
    const g = newGame(2, ['A']);
    for (let h = 0; h < 18; h++) {
      generateProperHole(2, h + 1);
      nextHole(g);
    }
  });`),
  'the whole course at module scope, outside any test': snippet(`const holes = COURSES.flatMap((_, c) =>
    Array.from({ length: PROPER_HOLES }, (_, n) => generateProperHole(c, n + 1)),
  );
  it('x', () => {
    for (const hole of holes) diceExpectation(hole);
  });`),
};

describe('the whole-course sweep guard (eslint.config.js)', () => {
  it.each(Object.entries(REJECTED))('rejects %s', (_name, code) => {
    expect(sweepErrors(code)).toBeGreaterThan(0);
  });

  it.each(Object.entries(ACCEPTED))('accepts %s', (_name, code) => {
    expect(sweepErrors(code)).toBe(0);
  });
});
