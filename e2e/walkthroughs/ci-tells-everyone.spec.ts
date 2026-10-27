import { test } from '@playwright/test';
import { SCENE_SECONDS, SCENES_HTML } from './ci-tells-everyone-scenes';

// The "CI tells everyone" explainer (factory step 2, part 1): a motion piece of animated
// diagrams — every tool through the same checks, the check page and the blockers comment
// saying the same thing, and the blockers comment filling and clearing.
// A pipeline change has nothing to screen-record. The recorder films this only for a pull
// request whose diff touches this file, its scenes or the scripts it explains
// (scripts/ship/pr-video-record.sh); every other pull request gets the generic walkthrough.
// walkthrough-covers: e2e/walkthroughs/ci-tells-everyone-scenes.ts
// walkthrough-covers: scripts/ship/pr-blockers.sh
// walkthrough-covers: scripts/ship/check-summary.sh

// The scenes are drawn for a 16:9 frame, which is what the finished video is: filmed
// once, at desktop size, rather than twice with the phone copy letterboxed.
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');

test('CI tells everyone explainer', async ({ page }) => {
  await page.setContent(SCENES_HTML);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    await page.waitForTimeout(seconds * 1_000);
  }
});
