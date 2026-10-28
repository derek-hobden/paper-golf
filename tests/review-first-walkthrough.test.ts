import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { pageHtml, RECORDING_SECONDS, SCENES, STAMP_ID } from '../e2e/walkthroughs/review-first-scenes';
import { sceneCutCss } from '../e2e/walkthroughs/scene-cut';

// The review-first explainer (PR 73): one scene at a time, in the PR Decision Video Standard's
// order, with real evidence, filmed only for a pull request that touches its scenes.
const SPEC = readFileSync('e2e/walkthroughs/review-first.spec.ts', 'utf8');

describe('the review-first walkthrough', () => {
  it('covers its own scenes file and nothing else', () => {
    const covers = SPEC.split('\n').filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/review-first-scenes.ts']);
    // No copy of the generic walkthrough: every other pull request gets default.spec.ts itself.
    expect(SPEC).not.toContain('defaultWalkthrough');
  });

  it('cuts from scene to scene, never fades', () => {
    const page = pageHtml([]);
    expect(page).toContain(sceneCutCss(SCENES.length));
    SCENES.forEach((_, i) => {
      expect(page).toContain(`<section id="s${String(i)}" class="scene `);
    });
    expect(page).not.toMatch(/transition:\s*opacity/);
  });

  it('opens on the verdict and ends on the decision, with why, risk and undo between', () => {
    const tags = SCENES.map((s) => (s.kind === 'diagram' ? s.tag : s.kind));
    const order = ['verdict', 'WHY', 'clip', 'WHAT CHANGES', 'clip', 'MATCHES THE ASK', 'RISK', 'clip', 'UNDO', 'decision'];
    // Consecutive clips are one beat (before, after) shown as several recordings.
    expect(tags.filter((t, i) => t !== 'clip' || tags[i - 1] !== 'clip')).toEqual(order);
    // No cap on the length (Derek, 28 Oct 2026), but enough to say something.
    expect(RECORDING_SECONDS).toBeGreaterThanOrEqual(60);
  });

  it('stamps the decision with the commit, and leaves the scene starts for beat mode', () => {
    const page = pageHtml([]);
    const decision = page.slice(page.indexOf(`<section id="s${String(SCENES.length - 1)}"`));
    expect(decision).toContain('DECISION');
    expect(decision).toContain(`id="${STAMP_ID}"`);
    expect(SPEC).toContain("execFileSync('git', ['rev-parse', '--short=7', 'HEAD']");
    expect(SPEC).toContain('beats.mark()');
    expect(SPEC).toContain('beats.save()');
  });

  it('plays every evidence line the spec names, once and in order, ending on its own review', () => {
    const evidence = SPEC.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));
    const clips = SCENES.flatMap((s) => (s.kind === 'clip' ? [s.clip] : []));
    expect(clips).toEqual(evidence.map((_, i) => i));
    expect(at(evidence, evidence.length - 1)).toMatch(/\| review 73$/);
  });
});
