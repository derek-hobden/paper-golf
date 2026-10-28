import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import { BEATS, type Clip, clipHtml, pageHtml, parseClips } from '../e2e/walkthroughs/review-first-2-scenes';

// PR 72's video: the explainer, then real terminal clips CI captured
// (scripts/ship/pr-video-evidence.sh), then the verdict.
describe('the evidence clips', () => {
  const good: Clip = {
    caption: 'The bug', command: 'gh run view 1 --log', captured_at: '2026-10-28T08:00:00Z', ok: true,
    cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: '',
    stream: btoa('$ gh run view 1\r\nok\r\n'), timing: [[0.01, 17], [0.4, 4]], lines: ['$ gh run view 1', 'ok'],
  };

  it('reads each clip field by field and drops the rest', () => {
    expect(parseClips([good, { ...good, ok: 'yes' }, null, 'x', { ...good, lines: ['c', 2] }])).toEqual([
      good,
      { ...good, lines: ['c'] },
    ]);
    expect(parseClips({ clips: [good] })).toEqual([]);
    // A terminal of no size, a recording that is not base64 and a timing that is not pairs are no clip.
    expect(parseClips([{ ...good, cols: 0 }, { ...good, rows: 2.5 }, { ...good, stream: '<script>' }])).toEqual([]);
    expect(parseClips([{ ...good, timing: [[1]] }, { ...good, timing: [[-1, 2]] }, { ...good, timing: 'x' }])).toEqual([]);
  });

  it('shows the caption, the headline and the stamp as text, never as markup', () => {
    const html = clipHtml({ ...good, caption: '<b>x</b>', headline: 'Passed in round 2: 1 minor note, no blockers' }, 3);
    expect(html).toContain('id="c-3"');
    expect(html).toContain('id="t-3"');
    expect(html).toContain('&#60;b&#62;x&#60;/b&#62;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('<p class=headline>Passed in round 2: 1 minor note, no blockers</p>');
    expect(html).toContain('Recorded live by CI (https://github.com/o/r/actions/runs/9) at 2026-10-28T08:00:00Z, in a 100×24 terminal');
    expect(clipHtml(good, 0)).not.toContain('headline');
  });

  it('says so when a clip was not captured, and marks a failed command', () => {
    expect(clipHtml(undefined, 0)).toContain('No evidence was captured for this clip in this run.');
    expect(clipHtml({ ...good, ok: false }, 0)).toContain('The command failed: this is its error');
    // With no evidence at all every clip beat still has a section to show.
    const page = pageHtml([]);
    for (const beat of BEATS) if (beat.kind === 'clip') expect(page).toContain(`id="c-${String(beat.clip)}"`);
  });

  it('hands the player the recording only, and nothing in it can close its script tag', () => {
    const page = pageHtml([{ ...good, caption: '</script><b>x</b>' }]);
    const json = /<script type="application\/json" id="clips">(.*?)<\/script>/s.exec(page)?.[1] ?? '';
    expect(JSON.parse(json)).toEqual([{ cols: 100, rows: 24, stream: good.stream, timing: good.timing }]);
    expect(page.match(/<\/script>/g)).toHaveLength(2);
  });
});

describe('the beats of the video', () => {
  const spec = readFileSync('e2e/walkthroughs/review-first-2.spec.ts', 'utf8');
  const evidence = spec.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));

  it('plays every evidence line the spec names, once and in order', () => {
    const clips = BEATS.flatMap((b) => (b.kind === 'clip' ? [b.clip] : []));
    expect(clips).toEqual(evidence.map((_, i) => i));
  });

  it('says the review in plain words, and how to undo it, just before the verdict', () => {
    const tail = BEATS.slice(-3);
    expect(tail.map((b) => b.kind)).toEqual(['clip', 'scene', 'verdict']);
    expect(at(tail, 0)).toMatchObject({ clip: evidence.length - 1 });
    expect(at(evidence, evidence.length - 1)).toMatch(/\| review 72$/);
    expect(at(tail, 1)).toMatchObject({ scene: 'undo' });
  });

  it('ends on the verdict card, held past the 2 s tail cut', () => {
    const last = BEATS[BEATS.length - 1];
    expect(last?.kind).toBe('verdict');
    expect(last?.seconds).toBeGreaterThanOrEqual(15);
    expect(BEATS.filter((b) => b.kind === 'verdict')).toHaveLength(1);
  });

  it('runs the explainer, then the evidence, then the verdict', () => {
    const firstClip = BEATS.findIndex((b) => b.kind === 'clip');
    const explainer = BEATS.slice(0, firstClip).reduce((s, b) => s + b.seconds, 0);
    expect(explainer).toBeGreaterThanOrEqual(45);
    expect(BEATS.slice(0, firstClip).every((b) => b.kind === 'scene')).toBe(true);
  });
});
