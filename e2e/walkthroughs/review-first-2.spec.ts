import { test } from '@playwright/test';
import { BEATS, beatId, pageHtml, parseClips } from './review-first-2-scenes';

// Review first, part 2 (PR 72): the motion explainer, then the evidence, then the verdict.
// The evidence is real: CI's evidence job runs each command below with a read-only token
// (scripts/ship/pr-video-evidence.sh) and the record job serves what it printed at
// /__evidence/evidence.json. Filmed only for a diff that touches this file or its scenes.
// walkthrough-covers: e2e/walkthroughs/review-first-2-scenes.ts
// walkthrough-evidence: Before, PR 70: the review was cut short, so it was not a pass | log 40568863322 match incomplete:
// walkthrough-evidence: Before, PR 70: the video was published anyway, two minutes later | run 40569177990
// walkthrough-evidence: After, PR 72: the ready mark alone records nothing | run 40633531983
// walkthrough-evidence: After, PR 72: then the review runs, and passes | log 40633532395 match paid=|blocking=
// walkthrough-evidence: After, PR 72: the passed label starts the recording | run 40633651091
// walkthrough-evidence: After, PR 72: a review that did not run makes no recording | run 40636254540
// walkthrough-evidence: After, PR 72: one blocked comment instead | comment 6459991237
// walkthrough-evidence: The bug, PR 72: no narration, so no video (publish attempt 1) | log 40628407877 attempt 1 match narration-model|##\[error\]claude
// walkthrough-evidence: The fix, PR 82: merged with every check green | checks 82

// Desktop size only. Skipped here, before any page opens, so the phone size records nothing to
// join in as a narrow column (issue 80).
test.skip(({ isMobile }) => isMobile, 'the video is filmed once, at desktop size');
test('review first part 2 explainer and evidence', async ({ page }) => {
  // The smoke suite's chrome project also runs walkthroughs: only the recorder films this one.
  test.skip(test.info().project.name !== 'desktop', 'the video is filmed by the recorder');
  test.setTimeout(240_000);
  const res = await page.request.get('/__evidence/evidence.json').catch(() => null);
  const clips = res?.ok() === true ? parseClips(await res.json()) : [];
  await page.setContent(pageHtml(clips));
  for (const beat of BEATS) {
    await page.evaluate((id) => {
      document.body.dataset['beat'] = id;
      for (const s of document.querySelectorAll('section')) s.classList.toggle('on', s.id === id);
    }, beatId(beat));
    await page.waitForTimeout(beat.seconds * 1_000);
  }
});
