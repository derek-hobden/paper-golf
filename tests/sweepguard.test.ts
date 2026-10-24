/**
 * The sweep guard is a lint rule (`no-restricted-syntax` for the test files in eslint.config.js), so these cases
 * prove it fires: the four shapes that timed a test out (issues 8, 9, 17 and 44) are rejected, and the shapes the
 * suite legitimately uses are not. Without them the selector could stop matching and the Guard rules row would
 * claim an enforcement that no longer happens.
 *
 * Each snippet is linted through the real config, as a test file: `lintText` needs a path the TypeScript project
 * service knows, so it is this suite's own `tests/green.test.ts` with the snippet as its text. One ESLint
 * instance lints them all at import, where the first lint's program build (~2.5s) and the ~0.1s lints after it
 * fall outside the per-test timeout — the point of this file in the first place. Every case below is an
 * assertion on an answer already in hand.
 */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';

const SWEEP_RULE = 'Sweep the course with it.each';
/** A real file in the project, in the rule's scope; `lintText` reads the snippet, not this file. */
const AS_FILE = 'tests/green.test.ts';

const HEAD = [
  "import { it } from 'vitest';",
  "import { COURSES, PROPER_HOLES, generateProperHole, generateProperHoleWithStats } from '../src/engine/generator';",
  "import { diceExpectation } from '../src/engine/solver';",
  "import { currentHole, newGame, nextHole } from '../src/game/game';",
  "import { playHoleTypically, seededD6 } from './sim';",
  "import { EVERY_COURSE, EVERY_HOLE } from './sweep';",
].join('\n');

const snippet = (body: string) => `${HEAD}\n${body}\n`;

/** The four sweeps that ran against the 30s per-test timeout, each in the shape it had. */
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
  'issue 44: the typical player over every layout, repeated': snippet(`it('x', () => {
    const d6 = seededD6(1);
    for (const { c } of EVERY_HOLE)
      for (let r = 0; r < 100; r++) playHoleTypically(newGame(c, ['Typical']), d6);
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
  'simulated rounds outside the test, asserted inside it': snippet(`const d6 = seededD6(1);
  let played = 0;
  for (const { c } of EVERY_HOLE)
    for (let r = 0; r < 100; r++) {
      playHoleTypically(newGame(c, ['Typical']), d6);
      played += 1;
    }
  it('x', () => {
    if (played < 1) throw new Error('nothing played');
  });`),
};

const eslint = new ESLint({});

/** How many times the sweep rule fires on `code` linted as a test file. */
async function sweepErrors(code: string): Promise<number> {
  const result = at(await eslint.lintText(code, { filePath: AS_FILE }), 0);
  const fatal = result.messages.filter((m) => m.fatal === true);
  if (fatal.length > 0) throw new Error(`eslint could not parse the snippet: ${JSON.stringify(fatal)}`);
  return result.messages.filter((m) => m.message.startsWith(SWEEP_RULE)).length;
}

// At import, not in a test: the first lint builds a TypeScript program, which is the slow part.
const verdicts = new Map<string, number>();
for (const [name, code] of [...Object.entries(REJECTED), ...Object.entries(ACCEPTED)]) {
  verdicts.set(name, await sweepErrors(code));
}

const verdict = (name: string): number => {
  const n = verdicts.get(name);
  if (n === undefined) throw new Error(`no verdict for ${name}`);
  return n;
};

describe('the whole-course sweep guard (eslint.config.js)', () => {
  it.each(Object.keys(REJECTED))('rejects %s', (name) => {
    expect(verdict(name)).toBeGreaterThan(0);
  });

  it.each(Object.keys(ACCEPTED))('accepts %s', (name) => {
    expect(verdict(name)).toBe(0);
  });
});
