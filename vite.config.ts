import { defineConfig } from 'vitest/config';

// This file is typechecked without @types/node (tsconfig types are vite/client).
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  base: './',
  plugins: [
    {
      // Vite drops `blocking` from the entry script; put it back so the first painted frame is the built screen
      // (browsers without render-blocking scripts paint the bare desk instead: `.boot #desk` in style.css).
      name: 'render-blocking-entry',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace('<script type="module" crossorigin', '<script type="module" blocking="render" crossorigin'),
      },
    },
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The npm test script passes the same cap. Stryker's vitest run reads it from here.
    maxWorkers: 4,
    // One retry in CI only. A pass on that retry is recorded by tests/flaky-reporter.ts.
    retry: process.env.CI ? 1 : 0,
    reporters: process.env.CI ? ['default', 'tests/flaky-reporter.ts'] : ['default'],
    coverage: {
      enabled: process.env.CI_COVERAGE === '1',
      provider: 'v8',
      include: ['src/engine/**', 'src/game/**'],
      reporter: ['json'],
      reportsDirectory: 'coverage',
    },
  },
});
