import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { DECISION, pageHtml, RECORDING_SECONDS, SCENES, STAMP_ID, stepLines } from '../e2e/walkthroughs/round-counter-scenes';
import type { Clip } from '../e2e/walkthroughs/review-first-2-scenes';
import { reviewWords } from '../e2e/walkthroughs/review-first-scenes';
import { sceneCutCss } from '../e2e/walkthroughs/scene-cut';

// The round counter explainer (issue 92): one scene at a time, in the PR Decision Video
// Standard's order, with real evidence, filmed only for a pull request that touches its scenes.
const SPEC = readFileSync('e2e/walkthroughs/round-counter.spec.ts', 'utf8');
const EVIDENCE = SPEC.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));

describe('the round counter walkthrough', () => {
  it('covers its own scenes file and nothing else', () => {
    const covers = SPEC.split('\n').filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/round-counter-scenes.ts']);
  });

  it('draws every card whole on the cut: nothing fades or slides in after it', () => {
    const page = pageHtml([]);
    expect(page).not.toContain('animation:pop');
    expect(page).not.toContain('@keyframes pop');
  });

  it('cuts from scene to scene, never fades', () => {
    const page = pageHtml([]);
    expect(page).toContain(sceneCutCss(SCENES.length));
    SCENES.forEach((_, i) => {
      expect(page).toContain(`<section id="s${String(i)}" class="scene `);
    });
    expect(page).not.toMatch(/transition:\s*opacity/);
  });

  it('opens on the plain intro and ends on the decision and then the review result, with risk and undo between', () => {
    const tags = SCENES.map((s) => (s.kind === 'diagram' ? s.tag : s.kind));
    const order = ['WHY', 'clip', 'WHAT CHANGES', 'clip', 'MATCHES THE ASK', 'RISK', 'clip', 'UNDO', 'decision', 'verdict'];
    expect(tags.filter((t, i) => t !== 'clip' || tags[i - 1] !== 'clip')).toEqual(order);
    expect(RECORDING_SECONDS).toBeGreaterThanOrEqual(60);
  });

  it('stamps the decision with the commit, and leaves the scene starts for beat mode', () => {
    const page = pageHtml([]);
    const decision = page.slice(page.indexOf(`<section id="s${String(SCENES.length - 2)}"`));
    expect(decision).toContain('DECISION');
    expect(decision).toContain(`id="${STAMP_ID}"`);
    expect(SPEC).toContain("execFileSync('git', ['rev-parse', '--short=7', 'HEAD']");
    expect(SPEC).toContain('beats.mark()');
    expect(SPEC).toContain('beats.save()');
  });

  it('plays every evidence line the spec names, once and in order, ending on its own review', () => {
    const clips = SCENES.flatMap((s) => (s.kind === 'clip' ? [s.clip] : []));
    expect(clips).toEqual(EVIDENCE.map((_, i) => i));
    expect(at(EVIDENCE, EVIDENCE.length - 1)).toMatch(/\| review 93$/);
  });

  it('shows the verdict from the review clip\'s own counts, and says it once', () => {
    const review: Clip = {
      caption: 'Review', command: 'PR=93 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-28T08:00:00Z',
      ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: 'Passed in round 1: no notes, no blockers',
      stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['round=1', 'found=', 'notes=0'],
    };
    const page = pageHtml([review]);
    expect(page).toContain(`<h1 class=said>${reviewWords([review])}</h1>`);
    expect(reviewWords([review])).toContain('found no problems that block merging');
    expect(page).not.toContain('Passed in round 1: no notes, no blockers');
  });

  it('quotes every word each scene shows in its step, and gives a scene no more time than its words', () => {
    const captions = EVIDENCE.map((l) => (l.slice(25).split(' | ')[0] ?? '').trim());
    const steps = stepLines(captions);
    expect(steps).toHaveLength(SCENES.length);
    SCENES.forEach((s, i) => {
      const step = at(steps, i);
      if (s.kind === 'diagram') {
        for (const words of [s.title, ...s.rows]) expect(step).toContain(`"${words}"`);
        const count = [s.title, ...s.rows].join(' ').split(/\s+/).length;
        expect(s.seconds).toBeLessThanOrEqual(Math.ceil(count / 2.2) + 2);
      }
      if (s.kind === 'clip') expect(step).toContain(`"${at(captions, s.clip)}"`);
    });
    const decision = at(steps, steps.length - 2);
    for (const words of Object.values(DECISION)) expect(decision).toContain(`"${words}"`);
    expect(SCENES.at(-2)?.seconds).toBeLessThanOrEqual(10);
    for (const step of steps) expect(step).not.toMatch(/\w\/\w|\/"/);
  });
});
