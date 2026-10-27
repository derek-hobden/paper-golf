import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENE_SECONDS, SCENES_HTML } from '../e2e/walkthroughs/review-first-scenes';

// The review-first explainer is filmed only for a pull request that touches it: the
// recorder picks a checked-in walkthrough by the paths on its `walkthrough-covers` lines,
// so the spec names its own scenes file and nothing a later pull request is likely to touch.

const SPEC = readFileSync('e2e/walkthroughs/review-first.spec.ts', 'utf8');

describe('the review-first walkthrough', () => {
  it('covers its own scenes file and nothing else', () => {
    const covers = SPEC.split('\n').filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/review-first-scenes.ts']);
    // No copy of the generic walkthrough: every other pull request gets default.spec.ts itself.
    expect(SPEC).not.toContain('defaultWalkthrough');
  });

  it('runs inside the 30 to 60 second video a narration fits, one scene per step', () => {
    const seconds = SCENE_SECONDS.reduce((a, b) => a + b, 0);
    expect(seconds).toBeGreaterThanOrEqual(30);
    expect(seconds).toBeLessThanOrEqual(60);
    SCENE_SECONDS.forEach((_, i) => {
      expect(SCENES_HTML).toContain(`<svg id="s${String(i)}" class="scene"`);
    });
  });
});
