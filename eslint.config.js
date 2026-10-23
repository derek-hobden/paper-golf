// Lint rules are the repo's memory: a mistake made twice becomes a rule here (or a test).
// Never disable a rule to get green; fix the code. See CLAUDE.md.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// A test body (`it(...)`, `test(...)`, `it.each(...)(...)` and the like), a loop or an iterating callback
// (`map`, `flatMap`, `forEach`, `Array.from`), and the calls that generate, solve or play a hole. Two iterations
// around one of those calls, inside a test, is the whole-course sweep that times tests out. At module scope it
// is not: nothing there runs against the per-test timeout (tests/windrule.test.ts builds its 90 holes that way,
// and tests/proper.sim.test.ts simulates its rounds that way).
const SWEEP_TEST =
  ":matches(CallExpression[callee.name=/^(it|test)$/], CallExpression[callee.object.name=/^(it|test)$/], CallExpression[callee.callee.object.name=/^(it|test)$/])";
const SWEEP_ITERATION =
  ":matches(ForStatement, ForOfStatement, ForInStatement, WhileStatement, CallExpression[callee.property.name=/^(map|flatMap|forEach)$/], CallExpression[callee.object.name='Array'][callee.property.name='from'])";
const SWEEP_CALL =
  "CallExpression[callee.name=/^(generateProperHole|generateProperHoleWithStats|diceExpectation|diceExpectedFromTee|playHoleTypically)$/]";

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/', 'coverage/', 'reports/', '.stryker-tmp/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    // Keep disableTypeChecked's parserOptions (no project service): plain JS files are not in tsconfig.
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: { ...globals.node } },
  },
  {
    files: ['tests/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // The generator, the solver or the typical player inside a test, under two nested iterations: courses x
          // holes, or layouts x repeats, the whole sweep. One level (a round's own 18 holes) is fine, and so is a
          // per-case sweep: `it.each` iterates outside the test body, not in it.
          selector: `${SWEEP_TEST} ${SWEEP_ITERATION} ${SWEEP_ITERATION} ${SWEEP_CALL}`,
          message:
            'Sweep the course with it.each(EVERY_HOLE) or it.each(EVERY_COURSE) from tests/sweep.ts, one case per hole or per course, or sweep outside the test and assert on the answer: generating, solving or playing the whole course inside one test runs it against the 30s per-test timeout (#8, #9, #17, #44).',
        },
      ],
    },
  },
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='click'] Property[key.name='force']",
          message: 'Tap board markers with tapMarker() from e2e/tap.ts: hit circles overlap by design (40cd666, 6d21d8f).',
        },
        {
          selector: "CallExpression[callee.property.name='click'][callee.object.arguments.0.value=/circle\\.hit|g\\.target/]",
          message: 'Tap board markers with tapMarker() from e2e/tap.ts: hit circles overlap by design (40cd666, 6d21d8f).',
        },
      ],
    },
  },
);
