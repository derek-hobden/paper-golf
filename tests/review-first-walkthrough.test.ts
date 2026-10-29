import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { DECISION, pageHtml, RECORDING_SECONDS, reviewWords, SCENES, STAMP_ID, stepLines } from '../e2e/walkthroughs/review-first-scenes';
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

  const review: Clip = {
    caption: 'Review', command: 'PR=73 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-28T08:00:00Z',
    ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: 'Passed in round 2: 1 minor note, no blockers',
    stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['$ PR=73 bash scripts/ship/review-findings.sh review', 'review_run=9', 'round=2', 'found=bug:1', 'fixed=1', 'notes=1'],
  };

  it('shows the review result word for word as the narration says it, in plain words, from the review clip\'s own counts', () => {
    // pr-video-script.sh says the same paragraph last (Derek, 29 Oct 2026: no "verdict", no bare "round 2").
    expect(reviewWords([review])).toBe('The automatic code review read the whole change twice. First it found 1 bug; it was fixed, and its last read found no problems that block merging. It left one small suggestion, which does not block anything. So this is safe to merge once a person approves it.');
    expect(reviewWords([{ ...review, lines: ['round=1', 'found=', 'notes=0'] }])).toBe('The automatic code review read the whole change and found no problems that block merging. So this is safe to merge once a person approves it.');
    expect(reviewWords([{ ...review, lines: ['round=3', 'found=bug:2 rule:1', 'notes=4'] }])).toBe('The automatic code review read the whole change three times. First it found 2 bugs and 1 rule problem; they were fixed, and its last read found no problems that block merging. It left 4 small suggestions, which do not block anything. So this is safe to merge once a person approves it.');
    expect(reviewWords([{ ...review, lines: ['round=4', 'found=', 'notes=0'] }])).toBe('The automatic code review read the whole change 4 times. It asked for changes first; they were made, and its last read found no problems that block merging. So this is safe to merge once a person approves it.');
    for (const lines of [['round=2', 'found=security:1 failing:2 unknown:1', 'notes=0'], ['round=1', 'found=', 'notes=1']]) {
      expect(reviewWords([{ ...review, lines }])).not.toMatch(/verdict|round \d/i);
    }
    expect(pageHtml([review])).toContain(`<h1 class=said>${reviewWords([review])}</h1>`);
    // A failed review command, or none, is never the result.
    expect(reviewWords([{ ...review, ok: false }])).toBe('The automatic code review found no problems that block merging. So this is safe to merge once a person approves it.');
    expect(reviewWords([])).toBe('The automatic code review found no problems that block merging. So this is safe to merge once a person approves it.');
  });

  it('says the verdict once: the review clip carries no green headline over its terminal', () => {
    const page = pageHtml([review]);
    expect(page).not.toContain('Passed in round 2: 1 minor note, no blockers');
    expect(page).not.toContain('class=headline');
  });

  it('quotes every word each scene shows in its step, and gives a scene no more time than its words', () => {
    const captions = SPEC.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: ')).map((l) => (l.slice(25).split(' | ')[0] ?? '').trim());
    const steps = stepLines(captions);
    expect(steps).toHaveLength(SCENES.length);
    SCENES.forEach((s, i) => {
      const step = at(steps, i);
      if (s.kind === 'diagram') {
        for (const words of [s.title, ...s.rows.map((r) => r.join(' '))]) expect(step).toContain(`"${words}"`);
        const count = [s.title, ...s.rows.flat()].join(' ').split(/\s+/).length;
        // About 2.2 words a second: room for the quoted words and little more.
        expect(s.seconds).toBeLessThanOrEqual(Math.ceil(count / 2.2) + 2);
      }
      if (s.kind === 'clip') expect(step).toContain(`"${at(captions, s.clip)}"`);
    });
    const decision = at(steps, steps.length - 1);
    for (const words of Object.values(DECISION)) expect(decision).toContain(`"${words}"`);
    expect(SCENES.at(-1)?.seconds).toBeLessThanOrEqual(10);
    // Nothing a step quotes is a path, which the narration never speaks.
    for (const step of steps) expect(step).not.toMatch(/\w\/\w|\/"/);
  });
});
