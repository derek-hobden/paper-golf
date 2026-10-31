import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { DECISION, pageHtml, RECORDING_SECONDS, SCENES, STAMP_ID, stepLines } from '../e2e/walkthroughs/video-gate-fail-closed-scenes';
import type { Clip } from '../e2e/walkthroughs/review-first-2-scenes';
import { reviewWords } from '../e2e/walkthroughs/review-first-scenes';
import { sceneCutCss } from '../e2e/walkthroughs/scene-cut';

// The "video gate fails closed" explainer: one scene at a time, in the plain-story order (the
// opening first, the review result last), with real evidence before and after, filmed only for the
// pull request that adds it.
const SPEC = readFileSync('e2e/walkthroughs/video-gate-fail-closed.spec.ts', 'utf8');
const EVIDENCE = SPEC.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));
const SHIP = readFileSync('scripts/ship/test-ship.sh', 'utf8');

describe('the video gate fails closed walkthrough', () => {
  it('covers its own scenes file and nothing else', () => {
    const covers = SPEC.split('\n').filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/video-gate-fail-closed-scenes.ts']);
  });

  it('cuts from scene to scene, never fades', () => {
    const page = pageHtml([]);
    expect(page).toContain(sceneCutCss(SCENES.length));
    SCENES.forEach((_, i) => {
      expect(page).toContain(`<section id="s${String(i)}" class="scene `);
    });
    expect(page).not.toMatch(/transition:\s*opacity/);
  });

  it('opens on what this is and what to decide, and ends on the decision and then the review result', () => {
    const tags = SCENES.map((s) => (s.kind === 'diagram' ? s.tag : s.kind));
    const order = ['WHAT THIS IS', 'WHY', 'clip', 'WHAT CHANGES', 'clip', 'MATCHES THE ASK', 'RISK', 'clip', 'UNDO', 'decision', 'verdict'];
    expect(tags.filter((t, i) => t !== 'clip' || tags[i - 1] !== 'clip')).toEqual(order);
    const opening = at(SCENES, 0);
    expect(opening.seconds).toBeLessThanOrEqual(15);
    expect(opening.kind === 'diagram' ? opening.rows.join(' ') : '').toContain('You decide');
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

  it('plays every evidence line once and in order: the real before, this pull request\'s own tests, its review', () => {
    const clips = SCENES.flatMap((s) => (s.kind === 'clip' ? [s.clip] : []));
    expect(clips).toEqual(EVIDENCE.map((_, i) => i));
    // Before: Dependabot's pull request 101, whose video check passed with no video (run 40971917414).
    expect(at(EVIDENCE, 0)).toMatch(/\| log 40971917414 match is exempt$/);
    expect(at(EVIDENCE, EVIDENCE.length - 1)).toMatch(/\| review \d+$/);
  });

  it('says what each test case proves, in the words the case prints', () => {
    for (const s of SCENES) {
      if (s.kind !== 'clip' || s.proves === undefined) continue;
      const line = at(EVIDENCE, s.clip);
      const name = line.replace(/^.* \| test /, '');
      const body = SHIP.slice(SHIP.indexOf(`t_${name}() {`));
      expect(body.slice(0, body.indexOf('\n}\n'))).toContain(`proves "${s.proves}"`);
    }
  });

  it('shows the review result last, in the plain words the narration says, and says it once', () => {
    const review: Clip = {
      caption: 'Review', command: 'PR=1 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-31T18:00:00Z',
      ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: 'Passed in round 1: no notes, no blockers',
      stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['round=1', 'found=', 'notes=0'],
    };
    const page = pageHtml([review]);
    const last = page.slice(page.indexOf(`<section id="s${String(SCENES.length - 1)}"`));
    expect(last).toContain('REVIEW RESULT');
    expect(last).toContain(`<h1 class=said>${reviewWords([review])}</h1>`);
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
      if (s.kind === 'clip') {
        expect(step).toContain(`"${at(captions, s.clip)}"`);
        if (s.proves !== undefined) expect(step).toContain(`"${s.proves}"`);
      }
    });
    const decision = at(steps, steps.length - 2);
    for (const words of Object.values(DECISION)) expect(decision).toContain(`"${words}"`);
    expect(SCENES.at(-1)?.seconds).toBeLessThanOrEqual(10);
    for (const step of steps) expect(step).not.toMatch(/\w\/\w|\/"/);
  });
});
