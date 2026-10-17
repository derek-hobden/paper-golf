import { defineConfig, devices } from '@playwright/test';

// Smoke test against the production build (`npm run build` first), served by `vite preview`.
// Uses the system Google Chrome (channel 'chrome') for every spec but e2e/iphone.spec.ts, plus Playwright's WebKit as an
// iPhone 14 (Safari) for every test tagged `@webkit` in its spec (`test(title, { tag: '@webkit' }, ...)` or the same on a
// `test.describe`), so a spec opts into WebKit itself and a new WebKit test never needs an edit here:
// `npx playwright install webkit` once per machine.

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const port = process.env.SMOKE_PORT ?? '4319';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL,
    headless: true,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' }, testIgnore: /iphone\.spec\.ts/ },
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] }, grep: /@webkit/ },
  ],
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
