import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { pageHtml, RECORDING_SECONDS, reviewWords, SCENES, STAMP_ID } from '../e2e/walkthroughs/review-first-scenes';
import type { Clip } from '../e2e/walkthroughs/review-first-2-scenes';
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

  it('says the review in its recorded words, and never a failed command as the verdict', () => {
    const review: Clip = {
      caption: 'Review', command: 'PR=73 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-28T08:00:00Z',
      ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: 'Passed in round 2: 1 problem fixed',
      stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['$ x'],
    };
    expect(reviewWords([review])).toBe('Passed in round 2: 1 problem fixed');
    expect(pageHtml([review])).toContain('<h1>Passed in round 2: 1 problem fixed</h1>');
    expect(reviewWords([{ ...review, ok: false, headline: 'No passed review was found for this commit' }])).toBe('The Claude review passed');
    expect(reviewWords([])).toBe('The Claude review passed');
  });
});
