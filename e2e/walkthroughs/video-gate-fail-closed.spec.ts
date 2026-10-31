import { execFileSync } from 'node:child_process';
import { test } from '@playwright/test';
import { Beats } from './beats';
import { pageHtml, SCENES, STAMP_ID } from './video-gate-fail-closed-scenes';
import { parseClips } from './review-first-2-scenes';

// The "video gate fails closed" explainer (Derek, 31 Oct 2026), in the plain-story order. Before and
// after are real: CI's evidence job runs each command below with a read-only token in a terminal
// `script` records (scripts/ship/pr-video-evidence.sh) — Dependabot's pull request 101 passing the
// video check with no video, then this pull request's own test cases — and xterm.js plays each one
// back at the size it was recorded at. The spec marks where each scene starts and leaves them as
// beats.json, so beat mode holds each scene for exactly its own paragraph of voice. The recorder
// films it only for the pull request that adds it.
// walkthrough-covers: e2e/walkthroughs/video-gate-fail-closed-scenes.ts
// walkthrough-evidence: Before, PR 101: the video check let Dependabot through | log 40971917414 match is exempt
// walkthrough-evidence: After: a Dependabot pull request with no video | test video_dependabot_without_a_video_fails
// walkthrough-evidence: After: the same pull request with its video on top | test video_dependabot_with_its_video_passes
// walkthrough-evidence: After: the dependency video's workflow | test ci_pr_video_deps_workflow
// walkthrough-evidence: Review: this pull request's own Claude review | review 104

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
test('video gate fails closed explainer', async ({ page }) => {
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
