import { defineConfig, devices } from '@playwright/test';

// Smoke test against the production build (`npm run build` first), served by `vite preview` — or, when
// SMOKE_BASE_URL is set, against that deployed URL (staging, then production, in .github/workflows/ci.yml),
// with no local server and the same specs. Deployments sit behind Vercel's SSO protection, so every request
// carries the protection-bypass header from VERCEL_AUTOMATION_BYPASS_SECRET when that is set.
// Uses the system Google Chrome (channel 'chrome') for every spec but e2e/iphone.spec.ts, plus Playwright's WebKit as an
// iPhone 14 (Safari) for every test tagged `@webkit` in its spec (`test(title, { tag: '@webkit' }, ...)` or the same on a
// `test.describe`), so a spec opts into WebKit itself and a new WebKit test never needs an edit here:
// `npx playwright install webkit` once per machine.

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const port = process.env.SMOKE_PORT ?? '4319';
// A deployed URL (no trailing slash) instead of the local preview server.
const deployed = process.env.SMOKE_BASE_URL?.replace(/\/+$/, '');
const baseURL = deployed ?? `http://localhost:${port}`;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

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
    // The bypass cookie keeps the following requests (and the page's own assets) through.
    ...(bypass === undefined
      ? {}
      : {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass': bypass,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }),
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' }, testIgnore: /iphone\.spec\.ts/ },
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] }, grep: /@webkit/ },
  ],
  // Only the local run serves the build itself; a deployed URL is already up.
  ...(deployed === undefined
    ? {
        webServer: {
          command: `npx vite preview --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 60_000,
        },
      }
    : {}),
});
