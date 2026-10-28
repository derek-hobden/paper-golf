import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
// tsconfig types are vite/client only, same as vite.config.ts.
declare const process: { env: Record<string, string | undefined> };
import { describe, expect, it } from 'vitest';
import { Beats } from '../e2e/walkthroughs/beats';
import { at } from './helpers';
import { SCENE_SECONDS, SCENES_HTML, STAMP_ID } from '../e2e/walkthroughs/review-first-scenes';

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

  it('draws one scene per step, with no cap on the length', () => {
    // Derek, 28 Oct 2026: no video length cap. At least long enough to say something.
    expect(SCENE_SECONDS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30);
    SCENE_SECONDS.forEach((_, i) => {
      expect(SCENES_HTML).toContain(`<svg id="s${String(i)}" class="scene"`);
      expect(SCENES_HTML).toContain(`body[data-scene="${String(i)}"] #s${String(i)} { opacity:1; }`);
    });
  });

  it('has a beat for matching the ask, and ends on the decision with the commit stamp', () => {
    expect(SCENES_HTML).toContain('MATCHES THE ASK');
    const decision = SCENES_HTML.slice(SCENES_HTML.indexOf(`<svg id="s${String(SCENE_SECONDS.length - 1)}"`));
    expect(decision).toContain('DECISION');
    expect(decision).toContain(`id="${STAMP_ID}"`);
    // The spec stamps the commit it films and leaves the scene starts for beat mode.
    expect(SPEC).toContain("execFileSync('git', ['rev-parse', '--short=7', 'HEAD']");
    expect(SPEC).toContain('beats.mark()');
    expect(SPEC).toContain('beats.save()');
  });
});

describe('the scene starts a walkthrough leaves for beat mode', () => {
  it('writes beats.json beside the clips, the starts in order, and nothing outside the recorder', () => {
    const dir = mkdtempSync('/tmp/beats-');
    mkdirSync(`${dir}/clips`);
    const before = process.env['VIDEO_OUT'];
    try {
      process.env['VIDEO_OUT'] = `${dir}/clips`;
      const beats = new Beats();
      beats.mark();
      beats.mark();
      beats.save();
      const saved: unknown = JSON.parse(readFileSync(`${dir}/beats.json`, 'utf8'));
      const starts = Array.isArray(saved) ? saved.filter((x: unknown): x is number => typeof x === 'number') : [];
      expect(starts).toHaveLength(2);
      expect(at(starts, 1)).toBeGreaterThanOrEqual(at(starts, 0));
      delete process.env['VIDEO_OUT'];
      expect(() => { new Beats().save(); }).not.toThrow();
    } finally {
      if (before === undefined) delete process.env['VIDEO_OUT'];
      else process.env['VIDEO_OUT'] = before;
    }
  });
});
