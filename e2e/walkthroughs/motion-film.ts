import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { Beats } from './beats';
import { type MotionScene, motionPage, resolveScenes, saveScript } from './motion';
import { parseClips } from './review-first-2-scenes';

/** The commit filmed: the record job checks out the head. */
const headSha = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

/**
 * Films a motion explainer: the evidence CI recorded (read at /__evidence/), every scene drawn
 * and animated from its own start, one at a time, each start kept for beat mode (beats.json)
 * and the words each scene shows and says kept as the narration (script.json).
 */
export async function filmMotion(page: Page, scenes: readonly MotionScene[]): Promise<void> {
  // The clock first, from the page's own creation: that is when its recording began.
  const beats = await Beats.from(page);
  const res = await page.request.get('/__evidence/evidence.json').catch(() => null);
  const clips = res?.ok() === true ? parseClips(await res.json()) : [];
  const filmed = resolveScenes(scenes, clips, headSha());
  await page.setContent(motionPage(filmed, clips));
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
  await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' });
  for (const [i, scene] of filmed.entries()) {
    await page.evaluate(
      ([n, clip, seconds]) => {
        document.body.dataset['scene'] = String(n);
        // A hidden scene's drawing runs on the page's clock: start it again as it comes up.
        const picture = document.querySelector(`#s${String(n)} svg.picture`);
        if (picture instanceof SVGSVGElement) picture.setCurrentTime(0);
        if (clip >= 0) window.dispatchEvent(new CustomEvent('play-clip', { detail: [clip, seconds] }));
      },
      [i, scene.picture.kind === 'clip' ? scene.picture.clip : -1, scene.seconds] as const,
    );
    beats.mark();
    await page.waitForTimeout(scene.seconds * 1_000);
  }
  beats.save();
  saveScript(filmed);
}
