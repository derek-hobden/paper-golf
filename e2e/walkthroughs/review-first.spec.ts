import { test } from '@playwright/test';
import { defaultWalkthrough } from './review-first-fallback';
import { filmsReviewFirst, SCENE_SECONDS, SCENES_HTML } from './review-first-scenes';

// The review-first explainer: a short motion piece of animated diagrams (before, the
// review and the recorder starting together, so a video could appear for work the review
// then rejected; after, the review first, a problems list and no video when it asks for
// changes, the fix-and-push loop of at most three rounds, and on a pass the review-passed
// label starting the recorder for a video in four parts). It plays only for a diff that
// touches a file of this change (REVIEW_FIRST_FILES); every other pull request gets exactly
// the generic walkthrough default.spec.ts films (review-first-fallback.ts).
// walkthrough-covers: scripts/ship/review-findings.sh
// walkthrough-covers: e2e/walkthroughs/review-first-scenes.ts

// This file runs in Node, but tsconfig only loads browser types.
declare const process: { env: Record<string, string | undefined> };

const files = (process.env.PR_FILES ?? '').split('\n').filter((f) => f !== '');
const scenes = filmsReviewFirst(files);

if (scenes) {
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
} else {
  test('explainer walkthrough', async ({ page }) => {
    await defaultWalkthrough(page);
  });
}
