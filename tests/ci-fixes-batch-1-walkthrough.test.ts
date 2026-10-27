import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENE_SECONDS, SCENES_HTML } from '../e2e/walkthroughs/ci-fixes-batch-1-scenes';

// PR 61's explainer: a motion piece, because a pipeline change has nothing to screen-record
// and the generic fallback, a few-second title card, left its first video at 10.9 s and
// 26 words (publish run 40518438125, refused by the audio gate). The recorder films it only
// for a diff that touches the spec or its scenes (scripts/ship/pr-video-record.sh).
describe('the CI fixes batch 1 walkthrough', () => {
  it('opts in by its own scenes only, so it never takes over a later pipeline change', () => {
    const spec = readFileSync('e2e/walkthroughs/ci-fixes-batch-1.spec.ts', 'utf8').split('\n');
    const covers = spec.filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/ci-fixes-batch-1-scenes.ts']);
  });

  it('runs long enough for a narration that says what each fix does', () => {
    const seconds = SCENE_SECONDS.reduce((a, b) => a + b, 0);
    // pr-video-script.sh asks for 2.2 words a second, at most 130: 56 s is about 123 words,
    // where the title card's 10.9 s was 26.
    expect(seconds).toBe(56);
    expect(SCENE_SECONDS.every((s) => s > 0)).toBe(true);
  });

  it('has one scene per hold, and every scene is a drawing', () => {
    const scenes = [...SCENES_HTML.matchAll(/<svg class="scene" id="s(\d+)"/g)].map((m) => Number(m[1]));
    expect(scenes).toEqual(SCENE_SECONDS.map((_, i) => i));
    for (const i of scenes) expect(SCENES_HTML).toContain(`body[data-scene="${String(i)}"] #s${String(i)}`);
  });

  it('shows no code, JSON or path for the voice to read over', () => {
    const shown = [...SCENES_HTML.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1] ?? '');
    expect(shown.length).toBeGreaterThan(10);
    for (const label of shown) {
      expect(label).not.toMatch(/[{}<>`$=]|\/|\.(sh|ya?ml|ts|json|mjs)\b/);
      expect(label.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
  });
});
