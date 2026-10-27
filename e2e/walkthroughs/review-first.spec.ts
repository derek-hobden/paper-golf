import { test } from '@playwright/test';
import { SCENE_SECONDS, SCENES_HTML } from './review-first-scenes';

// The review-first explainer: a short motion piece of animated diagrams (before, the
// review and the recorder starting together, so a video could appear for work the review
// then rejected; after, the review first, a problems list and no video when it asks for
// changes, the fix-and-push loop of at most three rounds, and on a pass the review-passed
// label starting the recorder for a video in four parts). The recorder films it only for a
// diff that touches this spec or its scenes (the line below); every other pull request gets
// the generic walkthrough, default.spec.ts.
// walkthrough-covers: e2e/walkthroughs/review-first-scenes.ts

// The scenes are drawn for a 16:9 frame, which is what the finished video is: filmed
// once, at desktop size, rather than twice with the phone copy letterboxed.
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');
test('review first explainer', async ({ page }) => {
  await page.setContent(SCENES_HTML);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    await page.waitForTimeout(seconds * 1_000);
  }
});
