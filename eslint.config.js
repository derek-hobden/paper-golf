// Lint rules are the repo's memory: a mistake made twice becomes a rule here (or a test).
// Never disable a rule to get green; fix the code. See CLAUDE.md.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'] },
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
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    // Keep disableTypeChecked's parserOptions (no project service): plain JS files are not in tsconfig.
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: { ...globals.node } },
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
