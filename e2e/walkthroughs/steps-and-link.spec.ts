import { test } from '@playwright/test';
import { SCENE_SECONDS, SCENES_HTML } from './steps-and-link-scenes';

// The "steps first, and the link stays" explainer (factory step 2, part 2): a motion piece of
// animated diagrams — a pull request with no `## How to see it` steps failing fast with an
// example, and a deleted video link coming back from the shelf.
// A pipeline change has nothing to screen-record. The recorder films this only for a pull
// request whose diff touches this file, its scenes or the scripts it explains
// (scripts/ship/pr-video-record.sh); every other pull request gets the generic walkthrough.
// walkthrough-covers: e2e/walkthroughs/steps-and-link-scenes.ts
// walkthrough-covers: scripts/ship/pr-body-sections.sh
// walkthrough-covers: scripts/ship/pr-video-restore.sh

// The scenes are drawn for a 16:9 frame, which is what the finished video is: filmed
// once, at desktop size, rather than twice with the phone copy letterboxed.
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');

test('steps and link explainer', async ({ page }) => {
  await page.setContent(SCENES_HTML);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    await page.waitForTimeout(seconds * 1_000);
  }
});
