import { execFileSync } from 'node:child_process';
import { test } from '@playwright/test';
import { Beats } from './beats';
import { SCENE_SECONDS, SCENES_HTML, STAMP_ID } from './review-first-scenes';

// The review-first explainer: a short motion piece of animated diagrams (the intent; before,
// the review and the recorder starting together, so a video could appear for work the review
// then rejected; after, the review first, a problems list and no video when it asks for
// changes, and on a pass the review-passed label starting the recorder; how that matches the
// ask; the picture held in step with the voice; and the decision, stamped with the commit it
// is for). The recorder films it only for a diff that touches its scenes (the line below);
// every other pull request gets the generic walkthrough, default.spec.ts.
// walkthrough-covers: e2e/walkthroughs/review-first-scenes.ts

/** The commit the decision is for, and when it was filmed: the record job checks out the head. */
const stamp = (): string => {
  let sha = 'unknown';
  try {
    sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // Outside a checkout the stamp says so rather than failing the film.
  }
  return `commit ${sha} · filmed ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

// The scenes are drawn for a 16:9 frame, which is what the finished video is: filmed
// once, at desktop size, rather than twice with the phone copy letterboxed.
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');
test('review first explainer', async ({ page }) => {
  test.setTimeout(240_000);
  // The clock first, from the page's own creation: that is when its recording began.
  const beats = await Beats.from(page);
  await page.setContent(SCENES_HTML);
  await page.evaluate(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }, [STAMP_ID, stamp()] as const);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    beats.mark();
    await page.waitForTimeout(seconds * 1_000);
  }
  beats.save();
});
