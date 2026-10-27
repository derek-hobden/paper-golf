import { test } from '@playwright/test';
import { SCENE_SECONDS, SCENES_HTML } from './ci-fixes-batch-1-scenes';

// The CI fixes batch 1 explainer (PR 61): a motion piece of animated diagrams, one scene per
// fix, before and after. A pipeline change has nothing to screen-record, and the generic
// fallback for it is a title card of a few seconds, which left this pull request's first
// video at 10.9 s and 26 words. The recorder films this only for a pull request whose diff
// touches this file or its scenes (scripts/ship/pr-video-record.sh); every other pull
// request gets the generic walkthrough.
// walkthrough-covers: e2e/walkthroughs/ci-fixes-batch-1-scenes.ts

// The scenes are drawn for a 16:9 frame, which is what the finished video is: filmed
// once, at desktop size, rather than twice with the phone copy letterboxed.
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');

test('CI fixes batch 1 explainer', async ({ page }) => {
  await page.setContent(SCENES_HTML);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    await page.waitForTimeout(seconds * 1_000);
  }
});
