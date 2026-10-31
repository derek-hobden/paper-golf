import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
// tsconfig types are vite/client only, same as vite.config.ts.
declare const process: { env: Record<string, string | undefined> };
import { describe, expect, it } from 'vitest';
import { Beats } from '../e2e/walkthroughs/beats';
import { pageHtml, RECORDING_SECONDS, SCENES, STAMP_ID } from '../e2e/walkthroughs/in-step-scenes';
import type { Clip } from '../e2e/walkthroughs/review-first-2-scenes';
import { sceneCutCss } from '../e2e/walkthroughs/scene-cut';
import { at } from './helpers';

// The video maker's own explainer (issue 80; Gus on pr-73-a9ecb5b.mp4): one scene at a time,
// in the PR Decision Video Standard's order, with real evidence and the scene starts left for
// beat mode.
const SPEC = readFileSync('e2e/walkthroughs/in-step.spec.ts', 'utf8');

describe('one scene at a time', () => {
  it('cuts: every scene is display none but the current one, with no transition', () => {
    const css = sceneCutCss(3);
    expect(css).toContain('.scene{display:none;transition:none}');
    for (const i of [0, 1, 2]) expect(css).toContain(`body[data-scene="${String(i)}"] #s${String(i)}{display:block}`);
    expect(css).not.toContain('#s3');
    expect(css).not.toMatch(/opacity|animation/);
  });

  it('draws the page with that cut and no fade between scenes', () => {
    const page = pageHtml([]);
    expect(page).toContain(sceneCutCss(SCENES.length));
    SCENES.forEach((_, i) => {
      expect(page).toContain(`<section id="s${String(i)}" class="scene `);
    });
    expect(page).not.toContain('transition:opacity');
  });
});

describe('the beats, in the standard order', () => {
  const tags = SCENES.map((s) => (s.kind === 'diagram' ? s.tag : s.kind));

  it('opens on the plain intro and ends on the decision and then the review result, with risk and undo between', () => {
    expect(tags[0]).toBe('WHY');
    expect(tags.at(-1)).toBe('verdict');
    const order = ['WHY', 'clip', 'WHAT CHANGES', 'clip', 'MATCHES THE ASK', 'RISK', 'clip', 'UNDO', 'decision', 'verdict'];
    // Consecutive clips are one beat (before, after) shown as several recordings.
    expect(tags.filter((t, i) => t !== 'clip' || tags[i - 1] !== 'clip')).toEqual(order);
    // No cap on the length (Derek, 28 Oct 2026), but enough to say something.
    expect(RECORDING_SECONDS).toBeGreaterThanOrEqual(60);
  });

  it('stamps the decision with the commit, and says the review result after it', () => {
    const page = pageHtml([]);
    const decision = page.slice(page.indexOf(`<section id="s${String(SCENES.length - 2)}"`));
    expect(decision).toContain('DECISION');
    expect(decision).toContain(`id="${STAMP_ID}"`);
    expect(SPEC).toContain("execFileSync('git', ['rev-parse', '--short=7', 'HEAD']");
  });

  it('says the review result in plain words, from the counts CI captured', () => {
    const review: Clip = {
      caption: 'Review', command: 'PR=9 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-28T08:00:00Z',
      ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: 'Passed in round 3: no blockers',
      stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['$ x'],
    };
    // The plain review result (reviewWords), never the clip's "Passed in round 3" headline.
    const page = pageHtml([{ ...review, lines: ['round=3', 'found=bug:1', 'notes=0'] }]);
    expect(page).toContain('<h1 class=said>The automatic code review read the whole change three times. First it found 1 bug; it was fixed, and its last read found no problems that block merging. So this is safe to merge once a person approves it.</h1>');
    expect(pageHtml([])).toContain('<h1 class=said>The automatic code review found no problems that block merging. So this is safe to merge once a person approves it.</h1>');
  });

  it('plays every evidence line the spec names, once and in order', () => {
    const evidence = SPEC.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));
    const clips = SCENES.flatMap((s) => (s.kind === 'clip' ? [s.clip] : []));
    expect(clips).toEqual(evidence.map((_, i) => i));
    expect(at(evidence, evidence.length - 1)).toMatch(/\| review \d+$/);
  });

  it('covers its own scenes file and nothing else, and leaves the scene starts', () => {
    const covers = SPEC.split('\n').filter((line) => line.startsWith('// walkthrough-covers:'));
    expect(covers).toEqual(['// walkthrough-covers: e2e/walkthroughs/in-step-scenes.ts']);
    expect(SPEC).toContain('beats.mark()');
    expect(SPEC).toContain('beats.save()');
  });
});

describe('the scene starts a walkthrough leaves for beat mode', () => {
  it('writes beats.json beside the clips, counted from when the page was made, and nothing outside the recorder', async () => {
    const dir = mkdtempSync('/tmp/beats-');
    mkdirSync(`${dir}/clips`);
    const before = process.env['VIDEO_OUT'];
    try {
      process.env['VIDEO_OUT'] = `${dir}/clips`;
      // The page's clock began 1.5 s ago: every start counts from there.
      const beats = await Beats.from({ evaluate: () => Promise.resolve(Date.now() - 1500) });
      beats.mark();
      beats.mark();
      beats.save();
      const saved: unknown = JSON.parse(readFileSync(`${dir}/beats.json`, 'utf8'));
      const starts = Array.isArray(saved) ? saved.filter((x: unknown): x is number => typeof x === 'number') : [];
      expect(starts).toHaveLength(2);
      expect(at(starts, 0)).toBeGreaterThanOrEqual(1.5);
      expect(at(starts, 1)).toBeGreaterThanOrEqual(at(starts, 0));
      delete process.env['VIDEO_OUT'];
      expect(() => { beats.save(); }).not.toThrow();
    } finally {
      if (before === undefined) delete process.env['VIDEO_OUT'];
      else process.env['VIDEO_OUT'] = before;
    }
  });
});
