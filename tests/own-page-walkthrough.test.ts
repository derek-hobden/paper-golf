import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { DECISION, pageHtml, PROVES, RECORDING_SECONDS, SCENES, STAMP_ID, stepLines } from '../e2e/walkthroughs/own-page-scenes';
import type { Clip } from '../e2e/walkthroughs/review-first-2-scenes';
import { reviewWords } from '../e2e/walkthroughs/review-first-scenes';
import { sceneCutCss } from '../e2e/walkthroughs/scene-cut';

// The "own page" explainer, in the plain-story order (AGENTS.md "Plain words for someone not
// in the loop"): the opening, before, what changes, after, risk, the decision, and the review
// result last in plain words, one scene at a time, with real evidence.
const SPEC = readFileSync('e2e/walkthroughs/own-page.spec.ts', 'utf8');
const SCENES_SOURCE = readFileSync('e2e/walkthroughs/own-page-scenes.ts', 'utf8');
const EVIDENCE = SPEC.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));
const captions = EVIDENCE.map((l) => (l.slice(25).split(' | ')[0] ?? '').trim());

describe('the own page walkthrough', () => {
  it('names its scenes file, so the recorder can check its steps against it', () => {
    const covers = SPEC.split('\n').filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/own-page-scenes.ts']);
  });

  it('cuts from scene to scene, never fades', () => {
    const page = pageHtml([]);
    expect(page).toContain(sceneCutCss(SCENES.length));
    SCENES.forEach((_, i) => {
      expect(page).toContain(`<section id="s${String(i)}" class="scene `);
    });
    expect(page).not.toMatch(/transition:\s*opacity/);
  });

  it('opens on what this is, why it matters and what to decide, and ends on the review result', () => {
    const tags = SCENES.map((s) => (s.kind === 'diagram' ? s.tag : s.kind));
    expect(tags).toEqual(['WHAT THIS IS', 'BEFORE', 'WHAT CHANGES', 'clip', 'RISK', 'decision', 'review']);
    const opening = at(SCENES, 0);
    // The opening is about the first 15 seconds (OPENING_SECONDS in pr-video-script.sh) and says
    // what is being decided.
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

  it('plays its after clip, and takes the review result from its own review', () => {
    const clips = SCENES.flatMap((s) => (s.kind === 'clip' ? [s.clip] : []));
    expect(clips).toEqual([0]);
    // The after is this pull request's own test of the rule, run for real, and never this pull
    // request's own page, which is the fault it fixes.
    expect(at(EVIDENCE, 0)).toMatch(/\| test record_refuses_its_own_page_as_evidence$/);
    for (const line of EVIDENCE) expect(line).not.toMatch(/\| pr \d+$/);
    // What it proves is printed by the test and quoted in the clip's step, so the narration says it
    // (the recorder refuses a test whose proves lines the steps do not quote).
    const ship = readFileSync('scripts/ship/test-ship.sh', 'utf8');
    const body = ship.slice(ship.indexOf('t_record_refuses_its_own_page_as_evidence() {'));
    const printed = [...body.slice(0, body.indexOf('\n}\n')).matchAll(/^\s*proves "([^"]+)"$/gm)].map((m) => m[1]);
    expect(printed).toEqual([...PROVES]);
    const step = at(stepLines(captions), SCENES.findIndex((s) => s.kind === 'clip'));
    for (const words of PROVES) expect(step).toContain(`"${words}"`);
    expect(at(EVIDENCE, 1)).toMatch(/\| review [1-9][0-9]*$/);
  });

  it('shows the review result in the plain words the narration says last', () => {
    const review: Clip = {
      caption: 'Review', command: 'PR=9 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-29T08:00:00Z',
      ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: 'Passed in round 1: no notes, no blockers',
      stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['round=1', 'found=', 'notes=0'],
    };
    const page = pageHtml([review]);
    const last = page.slice(page.indexOf(`<section id="s${String(SCENES.length - 1)}"`));
    expect(last).toContain('REVIEW RESULT');
    expect(last).toContain(`<h1 class=said>${reviewWords([review])}</h1>`);
    expect(reviewWords([review])).toBe('The automatic code review read the whole change and found no problems that block merging. So this is safe to merge once a person approves it.');
  });

  it('shows only plain words, so the voice says what the slide says and adds no gloss of its own', () => {
    // pr-98-abd872c.mp4 at 0:50: "Pipeline, docs and walkthroughs only" on screen was said as "the
    // checking line and written guides". Words the voice would have to explain stay off the slides.
    const jargon = /\b(pipeline|docs|walkthroughs?|CI|PR|repo|verdict|NIT|gate)\b/i;
    for (const s of SCENES) {
      if (s.kind === 'diagram') for (const words of [s.title, ...s.rows]) expect(words).not.toMatch(jargon);
    }
    for (const words of Object.values(DECISION)) expect(words).not.toMatch(jargon);
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
    const decision = at(steps, steps.length - 2);
    for (const words of Object.values(DECISION)) expect(decision).toContain(`"${words}"`);
    // pr-video-record.sh refuses a walkthrough whose steps quote words its files do not have.
    const own = SPEC + SCENES_SOURCE;
    for (const phrase of steps.join('\n').match(/"[^"]*"/g) ?? []) expect(own).toContain(phrase.slice(1, -1));
    for (const step of steps) expect(step).not.toMatch(/\w\/\w|\/"/);
  });
});
