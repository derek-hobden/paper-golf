import { test } from '@playwright/test';
import { SCENE_SECONDS, SCENES_HTML } from './review-first-2-scenes';

// Review first, part 2 (PR 72): a pipeline change has nothing to screen-record, so this
// is its motion explainer. Filmed only for a diff that touches this file or its scenes.
// walkthrough-covers: e2e/walkthroughs/review-first-2-scenes.ts
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');
test('review first part 2 explainer', async ({ page }) => {
  test.setTimeout(100_000); // the chrome smoke project runs this too, under its 60 s default
  await page.setContent(SCENES_HTML);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => (document.body.dataset['scene'] = String(n)), i);
    await page.waitForTimeout(seconds * 1_000);
  }
});
