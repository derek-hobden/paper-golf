import { test } from '@playwright/test';
import { SCENE_SECONDS, SCENES_HTML } from './session-ping-scenes';

// The session ping explainer: a short motion piece of animated diagrams (before, a
// stalled cloud session nobody hears about; after, the hook's one signal, Flo routing
// it to the bot that owns the session, and that bot acting). The recorder films it
// only for a pull request whose diff touches this file, its scenes or the hook it explains
// (scripts/ship/pr-video-record.sh); every other pull request gets the generic one.
// walkthrough-covers: scripts/factory/session-ping.sh
// walkthrough-covers: e2e/walkthroughs/session-ping-scenes.ts

// The scenes are drawn for a 16:9 frame, which is what the finished video is: filmed
// once, at desktop size, rather than twice with the phone copy letterboxed.
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');

test('session ping explainer', async ({ page }) => {
  await page.setContent(SCENES_HTML);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    await page.waitForTimeout(seconds * 1_000);
  }
});
