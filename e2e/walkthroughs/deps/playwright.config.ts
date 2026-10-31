import { defineConfig, devices } from '@playwright/test';

// The camera for a dependency update's explainer (scripts/ship/pr-video-deps.sh film), not a
// test run. It films one page main's own code draws from facts.json — no server, no build, and
// nothing from the pull request — once, at desktop size, the 16:9 frame the finished video is.
// Separate from ../playwright.config.ts, whose recorder serves the pull request's own build, and
// from the smoke suite's config, which ignores e2e/walkthroughs/ (AGENTS.md "PR explainer videos").

// This file runs in Node, but tsconfig only loads browser types (no @types/node).
declare const process: { env: Record<string, string | undefined> };

const DESKTOP = { width: 1280, height: 720 };
// As ../playwright.config.ts: the recording job runs as root in the Playwright container, where
// Chromium cannot start its sandbox, and CHROME_PATH lets a machine use its own Chromium.
const chromePath = process.env.CHROME_PATH;
const launchOptions = {
  ...(process.env.CHROME_NO_SANDBOX === '1' ? { chromiumSandbox: false as const } : {}),
  ...(chromePath !== undefined && chromePath !== '' && !chromePath.endsWith('.app')
    ? { executablePath: chromePath }
    : {}),
};

export default defineConfig({
  testDir: '.',
  testMatch: 'dependency-update.spec.ts',
  outputDir: process.env.VIDEO_OUT ?? '../../../pr-video/clips',
  reporter: 'list',
  workers: 1,
  timeout: 180_000,
  retries: 0,
  use: { headless: true, video: { mode: 'on', size: DESKTOP } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: DESKTOP, launchOptions } }],
});
