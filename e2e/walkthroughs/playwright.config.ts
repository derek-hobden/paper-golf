import { defineConfig, devices } from '@playwright/test';

// The explainer recorder, not a test run. It serves the production build and films
// the walkthrough twice — a phone and a desktop — leaving one .webm per size for
// .github/workflows/pr-video-publish.yml to narrate (AGENTS.md "PR explainer videos").
//
// Separate from playwright.config.ts on purpose: the smoke suite is a gate and runs in
// shards, while this is a camera. The main config ignores e2e/walkthroughs/ so a
// walkthrough spec never joins the suite, and nothing here is a required check.
// Both sizes are Chromium, so the recording needs only the browser the Playwright
// container already carries.

// This file runs in Node, but tsconfig only loads browser types (no @types/node).
declare const process: { env: Record<string, string | undefined> };

const port = process.env.VIDEO_PORT ?? '4320';
const baseURL = `http://localhost:${port}`;
// Each project films at its own size. A recording wider than the page it shows
// is a page in the corner of a grey rectangle; scripts/ship/pr-video-join.sh is
// what fits the phone clip into the finished video, letterboxed.
const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 412, height: 915 };
// CHROME_NO_SANDBOX: the recording job runs as root inside the Playwright container,
// where Chromium cannot start its sandbox. CHROME_PATH: the same override the smoke
// config takes, so a machine whose browsers were installed by another Playwright
// version can still film a walkthrough. CI sets the first and not the second.
const chromePath = process.env.CHROME_PATH;
const launchOptions = {
  ...(process.env.CHROME_NO_SANDBOX === '1' ? { chromiumSandbox: false as const } : {}),
  ...(chromePath !== undefined && chromePath !== '' && !chromePath.endsWith('.app')
    ? { executablePath: chromePath }
    : {}),
};

export default defineConfig({
  testDir: '.',
  outputDir: process.env.VIDEO_OUT ?? '../../pr-video/clips',
  reporter: 'list',
  workers: 1,
  // A walkthrough is as long as the pull request's own steps; the recording job caps it.
  timeout: 240_000,
  // The recording is the output: a step that cannot be followed is already handled
  // in the spec, and a retry would only film the same thing twice.
  retries: 0,
  use: {
    baseURL,
    headless: true,
    // Not 'reduce': the animations are half of what there is to see.
    video: { mode: 'on', size: DESKTOP },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: DESKTOP, launchOptions } },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: PHONE, video: { mode: 'on', size: PHONE }, launchOptions },
    },
  ],
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    // Playwright runs the command in the config file's own directory, and this
    // config does not live at the repo root: without this, vite preview starts
    // in e2e/walkthroughs/, finds no dist, and the readiness probe times out.
    cwd: '../..',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
