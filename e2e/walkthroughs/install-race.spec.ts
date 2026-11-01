import { execFileSync } from 'node:child_process';
import { test } from '@playwright/test';
import { Beats } from './beats';
import { pageHtml, SCENES, STAMP_ID } from './install-race-scenes';
import { parseClips } from './review-first-2-scenes';

// The "install race" explainer (PR 96), a bug fix: the bug reproduced from the real failed deploy,
// why it happened, the fix, then the real re-run that passed and this pull request's own tests.
// CI's evidence job runs each command below with a read-only token in a terminal `script` records
// (scripts/ship/pr-video-evidence.sh), and xterm.js plays each one back at the size it was recorded
// at. The spec marks where each scene starts and leaves them as beats.json, so beat mode holds each
// scene for exactly its own paragraph of voice. The recorder films it only for the pull request
// that adds it.
// walkthrough-covers: e2e/walkthroughs/install-race-scenes.ts
// walkthrough-evidence: Before: the deploy of 29 October, both tries of the Vercel install get npm's not found | log 40818700731 attempt 1 match : npm install --global|is not in this registry|failed after
// walkthrough-evidence: After: the same deploy re-run at 04:59, the install passes and staging goes live | log 40818700731 attempt 3 match : npm install --global|added [0-9]+ packages in|now points to
// walkthrough-evidence: After: the new test, the second try waits the pause it is given | test retry_waits_the_pause_before_the_next_attempt
// walkthrough-evidence: Before: this video's first publish, a narration of 23 words | log 40824078104 match words of narration
// walkthrough-evidence: After: the new test, a short narration is asked for again and the long one is used | test narration_script_asks_again_for_a_short_reply
// walkthrough-evidence: Review: this pull request's own Claude review, with its real round | review 96

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

// Desktop size only: the scenes are drawn for a 16:9 frame (issue 80).
test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');
test('install race explainer', async ({ page }) => {
  // The smoke suite's chrome project also runs walkthroughs: only the recorder films this one.
  test.skip(test.info().project.name !== 'desktop', 'the video is filmed by the recorder');
  test.setTimeout(300_000);
  // The clock first, from the page's own creation: that is when its recording began.
  const beats = await Beats.from(page);
  const res = await page.request.get('/__evidence/evidence.json').catch(() => null);
  const clips = res?.ok() === true ? parseClips(await res.json()) : [];
  await page.setContent(pageHtml(clips));
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
  await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' });
  await page.evaluate(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }, [STAMP_ID, stamp()] as const);
  for (const [i, scene] of SCENES.entries()) {
    await page.evaluate(
      ([n, clip, seconds]) => {
        document.body.dataset['scene'] = String(n);
        if (clip >= 0) window.dispatchEvent(new CustomEvent('play-clip', { detail: [clip, seconds] }));
      },
      [i, scene.kind === 'clip' ? scene.clip : -1, scene.seconds] as const,
    );
    beats.mark();
    await page.waitForTimeout(scene.seconds * 1_000);
  }
  beats.save();
});
