import { test } from '@playwright/test';
import { BEATS, beatId, pageHtml, parseClips } from './review-first-2-scenes';

// Review first, part 2 (PR 72): the motion explainer, then the evidence, then the verdict.
// The evidence is real: CI's evidence job runs each command below with a read-only token in a
// terminal `script` records (scripts/ship/pr-video-evidence.sh), the record job serves those
// recordings at /__evidence/evidence.json, and xterm.js plays each one back at the size it was
// recorded at. Nothing recorded is committed. Filmed only for a diff that touches this file or its scenes.
// walkthrough-covers: e2e/walkthroughs/review-first-2-scenes.ts
// walkthrough-evidence: Before, PR 70: the review was cut short, so it was not a pass | log 40568863322 match incomplete:
// walkthrough-evidence: Before, PR 70: the video was published anyway, two minutes later | run 40569177990
// walkthrough-evidence: After, PR 72: the ready mark alone records nothing | run 40633531983
// walkthrough-evidence: After, PR 72: then the review runs, and passes | log 40633532395 match paid=|blocking=
// walkthrough-evidence: After, PR 72: the passed label starts the recording | run 40633651091
// walkthrough-evidence: After, PR 72: a review that did not run makes no recording | run 40636254540
// walkthrough-evidence: After, PR 72: main's label step refused that run (fixed here) | log 40636254540 match HTTP 403|##\[error\]
// walkthrough-evidence: The bug, PR 72: no narration, so no video (publish attempt 1) | log 40628407877 attempt 1 match narration-model|##\[error\]claude
// walkthrough-evidence: The fix, PR 82: merged with every check green | checks 82
// walkthrough-evidence: Review: this pull request's own Claude review | review 72

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
  // The terminal emulator, from the repository's own node_modules (the recorder runs at its root).
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
  await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' });
  for (const beat of BEATS) {
    await page.evaluate(
      ([id, clip, seconds]) => {
        document.body.dataset['beat'] = id;
        for (const s of document.querySelectorAll('section')) s.classList.toggle('on', s.id === id);
        if (clip >= 0) window.dispatchEvent(new CustomEvent('play-clip', { detail: [clip, seconds] }));
      },
      [beatId(beat), beat.kind === 'clip' ? beat.clip : -1, beat.seconds] as const,
    );
    await page.waitForTimeout(beat.seconds * 1_000);
  }
});
