/**
 * The whole-course sweeps as `it.each` cases, one per hole or per course.
 *
 * Generating a Proper golf hole searches seeds until one validates, and every attempt runs the solver, so the
 * 90-hole course costs several seconds of CPU (about 6.7s on a quiet machine). A sweep that runs it inside a
 * single test spends all of that against the 30s per-test timeout (`npm test`), and on a loaded CI runner, where
 * v8 coverage and four workers roughly triple each test's wall clock, those seconds become tens of seconds and
 * the test times out (issues 8, 9, 17 and 44). Sweep through these lists instead: each case pays for one hole (or
 * one course), so the work per test stays a small fraction of the budget. A sweep whose claim is one number over
 * the whole course instead runs outside the test, where no timeout applies, and the cases assert the answer it
 * left (`tests/windrule.test.ts`, `tests/proper.sim.test.ts`). The `no-restricted-syntax` rule for the test files
 * in `eslint.config.js` fails a sweep that goes back inside one test.
 */
import { COURSES, PROPER_HOLES } from '../src/engine/generator';

/** Every course, as a case: 0..4. */
export const EVERY_COURSE: readonly number[] = COURSES.map((_, c) => c);

/** Every Proper golf hole, as a case: 5 courses x 18 holes. */
export const EVERY_HOLE: readonly { c: number; n: number }[] = COURSES.flatMap((_, c) =>
  Array.from({ length: PROPER_HOLES }, (_, i) => ({ c, n: i + 1 })),
);
