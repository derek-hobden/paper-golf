import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { DECISION, pageHtml, RECORDING_SECONDS, SCENES, STAMP_ID, stepLines, verdictWords } from '../e2e/walkthroughs/plain-story-scenes';
import type { Clip } from '../e2e/walkthroughs/review-first-2-scenes';
import { sceneCutCss } from '../e2e/walkthroughs/scene-cut';

// The "plain story" explainer (PR 97): narrated by main's video maker as it was before this pull
// request, so it opens on the verdict that maker says; one scene at a time, with real evidence.
const SPEC = readFileSync('e2e/walkthroughs/plain-story.spec.ts', 'utf8');
const SCENES_SOURCE = readFileSync('e2e/walkthroughs/plain-story-scenes.ts', 'utf8');
const EVIDENCE = SPEC.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));
const captions = EVIDENCE.map((l) => (l.slice(25).split(' | ')[0] ?? '').trim());

describe('the plain story walkthrough', () => {
  it('names its scenes file, so the recorder can check its steps against it', () => {
    const covers = SPEC.split('\n').filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/plain-story-scenes.ts']);
  });

  it('cuts from scene to scene, never fades', () => {
    const page = pageHtml([]);
    expect(page).toContain(sceneCutCss(SCENES.length));
    SCENES.forEach((_, i) => {
      expect(page).toContain(`<section id="s${String(i)}" class="scene `);
    });
    expect(page).not.toMatch(/transition:\s*opacity/);
  });

  it('opens on the verdict, then why, before, the changes, after, risk, the review and the decision', () => {
    const tags = SCENES.map((s) => (s.kind === 'diagram' ? s.tag : s.kind));
    expect(tags).toEqual(['verdict', 'WHY', 'BEFORE', 'clip', 'WHAT CHANGES', 'WHAT CHANGES', 'clip', 'clip', 'RISK', 'clip', 'decision']);
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

  it('plays every evidence line once and in order, ending on its own review', () => {
    const clips = SCENES.flatMap((s) => (s.kind === 'clip' ? [s.clip] : []));
    expect(clips).toEqual(EVIDENCE.map((_, i) => i));
    expect(at(EVIDENCE, EVIDENCE.length - 1)).toMatch(/\| review 97$/);
    // The after clip runs this pull request's own test of the recorder rule.
    expect(SPEC).toContain('| test record_films_only_the_walkthrough_a_pull_request_adds');
  });

  it("shows the verdict main's video maker says over it, from the review clip's own counts", () => {
    const review: Clip = {
      caption: 'Review', command: 'PR=97 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-29T08:00:00Z',
      ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: 'Passed in round 1: 3 minor notes, no blockers',
      stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['round=1', 'found=', 'notes=3'],
    };
    // Main's pr-video-script.sh: "Verdict: the review passed in round N with no blocking problems left; ..."
    expect(verdictWords([review])).toBe('The review passed in round 1 with no blocking problems left; nothing needed fixing, with 3 notes. It is ready for a person to approve.');
    expect(pageHtml([review])).toContain(`<h1 class=said>${verdictWords([review])}</h1>`);
    expect(pageHtml([review])).not.toContain('Passed in round 1: 3 minor notes, no blockers');
    expect(verdictWords([])).toBe('The review passed. It is ready for a person to approve.');
  });

  it('quotes every word each scene shows in its step, and every quoted word is in its own files', () => {
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
    const decision = at(steps, steps.length - 1);
    for (const words of Object.values(DECISION)) expect(decision).toContain(`"${words}"`);
    // pr-video-record.sh refuses a walkthrough whose steps quote words its files do not have.
    const own = SPEC + SCENES_SOURCE;
    for (const phrase of steps.join('\n').match(/"[^"]*"/g) ?? []) expect(own).toContain(phrase.slice(1, -1));
    for (const step of steps) expect(step).not.toMatch(/\w\/\w|\/"/);
  });
});
